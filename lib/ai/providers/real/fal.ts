/**
 * fal.ai: one key for object outlines (SAM 3), image-to-3D (TRELLIS / Hunyuan3D), file hosting
 * (fal CDN), and optionally scene analysis (vision LLMs via OpenRouter).
 */
import type {
  FileStorage,
  MeshStatus,
  Object3DProvider,
  SegmentProvider,
  VisionProvider,
} from "@/lib/ai/types";
import { type BoundingBox, type MemoryAnalysis, parseAnalysis } from "@/lib/analysis/schema";
import { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from "./vision-prompt";

export class FalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class FalClient {
  constructor(private readonly key: string) {}

  private headers() {
    return { Authorization: `Key ${this.key}`, "Content-Type": "application/json" };
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FalError(`fal ${what} → ${res.status}: ${body.slice(0, 300)}`, res.status);
    }
    return (await res.json()) as T;
  }

  /** Blocking call, for fast models (vision, segmentation). */
  async run<T>(endpoint: string, input: unknown): Promise<T> {
    const res = await fetch(`https://fal.run/${endpoint}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    return this.json<T>(res, endpoint);
  }

  /** Queued call, for slow models. Keep the returned URLs to poll. */
  async submit(endpoint: string, input: unknown) {
    const res = await fetch(`https://queue.fal.run/${endpoint}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    return this.json<{ request_id: string; status_url: string; response_url: string }>(
      res,
      `${endpoint} submit`,
    );
  }

  async status(statusUrl: string) {
    const res = await fetch(statusUrl, { headers: this.headers(), cache: "no-store" });
    return this.json<{ status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED"; error?: string }>(
      res,
      "status",
    );
  }

  async result<T>(responseUrl: string): Promise<T> {
    const res = await fetch(responseUrl, { headers: this.headers(), cache: "no-store" });
    return this.json<T>(res, "result");
  }
}

/** Any OpenRouter vision model (Gemini by default) reading the photograph, billed through fal. */
export class FalVisionProvider implements VisionProvider {
  constructor(
    private readonly fal: FalClient,
    private readonly model: string,
  ) {}

  async analyze(photoUrl: string): Promise<MemoryAnalysis> {
    const { output } = await this.fal.run<{ output: string }>("openrouter/router/vision", {
      model: this.model,
      system_prompt: VISION_SYSTEM_PROMPT,
      prompt: VISION_USER_PROMPT,
      image_urls: [photoUrl],
      temperature: 0.2,
      max_tokens: 6000,
    });
    return parseAnalysis(output);
  }
}

/** SAM 3 finds the object by name; we keep the mask box closest to the vision model's guess. */
export class FalSegmentProvider implements SegmentProvider {
  constructor(private readonly fal: FalClient) {}

  async refineBox(photoUrl: string, label: string, hint: BoundingBox): Promise<BoundingBox | null> {
    const out = await this.fal.run<{ boxes?: number[][] | null }>("fal-ai/sam-3/image", {
      image_url: photoUrl,
      prompt: label,
      include_boxes: true,
      return_multiple_masks: true,
      max_masks: 5,
      apply_mask: false,
    });
    const candidates = (out.boxes ?? []).map(
      ([cx, cy, w, h]): BoundingBox => [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
    );
    let best: BoundingBox | null = null;
    let bestIou = 0.1; // below this, SAM found a different instance; trust the hint instead
    for (const box of candidates) {
      const score = iou(box, hint);
      if (score > bestIou) {
        best = box;
        bestIou = score;
      }
    }
    return best;
  }
}

/** Image-to-3D models on fal, and how to talk to each. Prices are per object. */
export const MESH_MODELS = {
  /** $0.02. Fast and cheap; good enough for most room-scale props. */
  trellis: {
    endpoint: "fal-ai/trellis",
    // Default simplification (0.95) leaves ~4k triangles; 0.9 (the minimum) keeps curves rounder.
    input: (image_url: string) => ({ image_url, texture_size: 1024, mesh_simplify: 0.9 }),
    output: (o: FalFiles) => o.model_mesh?.url,
  },
  /** $0.25 at 512p. Cleaner topology and textures. */
  "trellis-2": {
    endpoint: "fal-ai/trellis-2",
    input: (image_url: string) => ({
      image_url,
      resolution: 512,
      texture_size: 1024,
      decimation_target: 100_000,
    }),
    output: (o: FalFiles) => o.model_glb?.url,
  },
  /** $0.375. Detailed PBR assets. */
  "hunyuan3d-v3": {
    endpoint: "fal-ai/hunyuan3d-v3/image-to-3d",
    input: (input_image_url: string) => ({
      input_image_url,
      // Room-scale objects next to a splat: detail past ~150k faces isn't visible, but load time is.
      face_count: 150_000,
      generate_type: "Normal",
      enable_pbr: true,
    }),
    output: (o: FalFiles) => o.model_glb?.url,
  },
} as const;

export type MeshModel = keyof typeof MESH_MODELS;
type FalFiles = { model_glb?: { url?: string }; model_mesh?: { url?: string } };

export function isMeshModel(name: string | undefined): name is MeshModel {
  return Boolean(name && name in MESH_MODELS);
}

export class FalMeshProvider implements Object3DProvider {
  constructor(
    private readonly fal: FalClient,
    private readonly model: MeshModel,
  ) {}

  async submit(imageUrl: string, label?: string): Promise<string> {
    const m = MESH_MODELS[this.model];
    // A clean cutout of just this object; the crop itself if every cutout fails.
    const input = await cutOut(this.fal, imageUrl, label).catch(() => imageUrl);
    const job = await this.fal.submit(m.endpoint, m.input(input));
    return JSON.stringify({
      model: this.model,
      status: job.status_url,
      response: job.response_url,
    });
  }

  async poll(handle: string): Promise<MeshStatus> {
    const { model, status, response } = JSON.parse(handle) as {
      model?: MeshModel;
      status: string;
      response: string;
    };
    const s = await this.fal.status(status);
    if (s.error) return { state: "failed", error: s.error };
    if (s.status !== "COMPLETED") return { state: "pending" };
    const out = await this.fal.result<FalFiles>(response);
    const glbUrl = MESH_MODELS[model ?? this.model].output(out);
    return glbUrl ? { state: "succeeded", glbUrl } : { state: "failed", error: "no mesh returned" };
  }
}

/**
 * Cuts the object out of its crop (BiRefNet, ~$0.001). Image-to-3D models reconstruct
 * whatever is in the picture, so background left in a crop comes back as a slab behind the
 * object. Returns the URL of a transparent PNG.
 */
export async function removeBackground(fal: FalClient, imageUrl: string): Promise<string> {
  const out = await fal.run<{ image?: { url?: string } }>("fal-ai/birefnet/v2", {
    image_url: imageUrl,
    model: "General Use (Heavy)",
    output_format: "png",
    refine_foreground: true,
  });
  if (!out.image?.url) throw new FalError("background removal returned no image", 502);
  return out.image.url;
}

/** Every framed photograph or picture SAM 3 can find in the photo. */
export async function findFrames(fal: FalClient, photoUrl: string) {
  const out = await fal.run<{ metadata?: { score: number; box: number[] }[] | null }>(
    "fal-ai/sam-3/image",
    {
      image_url: photoUrl,
      prompt: "framed photograph",
      apply_mask: false,
      include_boxes: true,
      include_scores: true,
      return_multiple_masks: true,
      max_masks: 12,
      output_format: "png",
    },
  );
  return (out.metadata ?? []).map(({ score, box: [cx, cy, w, h] }) => ({
    score,
    box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] as BoundingBox,
  }));
}

/** SAM 3 below this confidence may have picked the wrong thing: use generic removal. */
const MIN_CUTOUT_SCORE = 0.3;

/**
 * Isolates the named object in its crop. SAM 3 cuts out *that* object; generic background
 * removal guesses at "the subject", which fails on busy or painted scenes (it once kept the
 * room and removed the kettle).
 */
export async function cutOut(fal: FalClient, imageUrl: string, label?: string): Promise<string> {
  if (label) {
    const out = await fal
      .run<{ image?: { url?: string } | null; scores?: number[] | null }>("fal-ai/sam-3/image", {
        image_url: imageUrl,
        prompt: label,
        apply_mask: true,
        include_scores: true,
        output_format: "png",
      })
      .catch(() => null);
    const score = out?.scores?.[0] ?? 0;
    if (out?.image?.url && score >= MIN_CUTOUT_SCORE) return out.image.url;
  }
  return removeBackground(fal, imageUrl);
}

/** fal's CDN: public, unguessable URLs that fal's own models can fetch. */
export class FalStorage implements FileStorage {
  constructor(private readonly key: string) {}

  async upload(bytes: Uint8Array<ArrayBuffer>, contentType: string, fileName: string) {
    const init = await fetch(
      "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
      {
        method: "POST",
        headers: { Authorization: `Key ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: contentType, file_name: fileName }),
      },
    );
    if (!init.ok) {
      throw new FalError(
        `fal storage → ${init.status}: ${(await init.text()).slice(0, 200)}`,
        init.status,
      );
    }
    const { upload_url, file_url } = (await init.json()) as {
      upload_url: string;
      file_url: string;
    };
    const put = await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes,
    });
    if (!put.ok) throw new FalError(`fal storage upload → ${put.status}`, put.status);
    return file_url;
  }
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}
