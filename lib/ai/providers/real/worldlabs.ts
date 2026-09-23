import type {
  GenerationJob,
  GenerationStatus,
  WorldGenerationInput,
  WorldProvider,
  WorldResult,
} from "@/lib/ai/types";

const API = "https://api.worldlabs.ai/marble/v1";
export const EXISTING_WORLD = "world_";

interface World {
  world_id: string;
  world_prompt?: null | { image_prompt?: { uri?: string | null } | null };
  assets?: {
    caption?: string;
    thumbnail_url?: string | null;
    imagery?: { pano_url?: string | null };
    splats?: {
      spz_urls?: Record<string, string>;
      semantics_metadata?: null | { metric_scale_factor?: number; ground_plane_offset?: number };
    };
  };
}

interface Operation {
  operation_id: string;
  done: boolean;
  error: null | string | { message?: string; code?: string };
  metadata: null | { progress?: { status?: string; description?: string }; world_id?: string };
  /** Snapshot of the world. Lacks some assets (the pano), so we fetch the world itself. */
  response: null | World;
}

/** World Labs Marble: one photograph in, one Gaussian-splat world out (~5 min). */
export class WorldLabsProvider implements WorldProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async create(input: WorldGenerationInput): Promise<GenerationJob> {
    const mediaAssetId = await this.upload(input.image.bytes, input.image.extension);
    const op = await this.request<Operation>("/worlds:generate", {
      method: "POST",
      body: JSON.stringify({
        display_name: input.displayName,
        model: this.model,
        world_prompt: {
          type: "image",
          image_prompt: { source: "media_asset", media_asset_id: mediaAssetId },
          // A memory is a single photograph, never a panorama.
          is_pano: false,
          ...(input.prompt ? { text_prompt: input.prompt } : {}),
        },
      }),
    });
    return { jobId: op.operation_id };
  }

  async getStatus(jobId: string): Promise<GenerationStatus> {
    // `world_<id>` reopens a world that already exists, without generating (or paying) again.
    if (jobId.startsWith(EXISTING_WORLD)) {
      const world = await this.request<World>(
        `/worlds/${encodeURIComponent(jobId.slice(EXISTING_WORLD.length))}`,
      );
      if (!world.assets?.splats?.spz_urls) return { state: "pending" };
      return { state: "succeeded", result: toResult(world) };
    }
    const op = await this.request<Operation>(`/operations/${encodeURIComponent(jobId)}`);
    if (op.error) {
      const message = typeof op.error === "string" ? op.error : (op.error.message ?? "failed");
      return { state: "failed", error: message };
    }
    if (!op.done || !op.response) {
      return { state: "pending", progress: op.metadata?.progress?.status };
    }
    const world = await this.request<World>(
      `/worlds/${encodeURIComponent(op.response.world_id)}`,
    ).catch(() => op.response as World);
    return { state: "succeeded", result: toResult(world) };
  }

  private async upload(bytes: Uint8Array<ArrayBuffer>, extension: string): Promise<string> {
    const prepared = await this.request<{
      // The docs say `id`; the live API returns `media_asset_id`.
      media_asset: { media_asset_id?: string; id?: string };
      upload_info: {
        upload_url: string;
        upload_method: string;
        required_headers?: Record<string, string>;
      };
    }>("/media-assets:prepare_upload", {
      method: "POST",
      body: JSON.stringify({ file_name: `memory.${extension}`, kind: "image", extension }),
    });

    const { upload_url, upload_method, required_headers } = prepared.upload_info;
    const res = await fetch(upload_url, {
      method: upload_method,
      headers: required_headers,
      body: bytes,
    });
    if (!res.ok) throw new WorldLabsError(`photo upload failed (${res.status})`, res.status);
    const id = prepared.media_asset.media_asset_id ?? prepared.media_asset.id;
    if (!id) throw new WorldLabsError("prepare_upload returned no media asset id", 502);
    return id;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "WLT-Api-Key": this.apiKey, ...init.headers },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new WorldLabsError(
        `World Labs ${path} → ${res.status}: ${body.slice(0, 300)}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  }
}

export class WorldLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function toResult(world: World): WorldResult {
  const urls = world.assets?.splats?.spz_urls ?? {};
  const splatUrl = urls["500k"] ?? urls.full_res ?? Object.values(urls)[0];
  if (!splatUrl) throw new Error("World Labs returned a world with no splat");
  return {
    splatUrl,
    splatUrlLowRes: urls["100k"],
    splatUrlHighRes: urls.full_res && urls.full_res !== splatUrl ? urls.full_res : undefined,
    format: "spz",
    metricScale: world.assets?.splats?.semantics_metadata?.metric_scale_factor ?? 1,
    panoUrl: world.assets?.imagery?.pano_url ?? undefined,
    thumbnailUrl: world.assets?.thumbnail_url ?? undefined,
    sourcePhotoUrl: world.world_prompt?.image_prompt?.uri ?? undefined,
    metadata: {
      provider: "worldlabs",
      worldId: world.world_id,
      caption: world.assets?.caption,
      generatedAt: new Date().toISOString(),
    },
  };
}
