import { after, NextResponse } from "next/server";
import { getWorldProvider } from "@/lib/ai";
import { getExtrasDeps } from "@/lib/ai/extras";
import type { GenerationStatus } from "@/lib/ai/types";
import {
  addToGallery,
  getGalleryEntry,
  type JobRecord,
  jobKey,
  updateGalleryExtras,
} from "@/lib/gallery";
import {
  advanceExtras,
  type PublicExtras,
  readExtras,
  toPublicExtras,
} from "@/lib/pipeline/extras";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** Mock job, World Labs operation, `world_<id>` (an existing world) or `gallery_<id>`. */
const JOB_ID = /^(mock_[0-9a-z]+_[0-9a-f]+|(world_)?[0-9a-f-]{36}|gallery_[0-9a-f]{16})$/i;

export type StatusResponse = GenerationStatus & { extras?: PublicExtras };

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  const store = getStore();

  if (jobId.startsWith("gallery_")) {
    const entry = await getGalleryEntry(store, jobId.slice("gallery_".length));
    if (!entry) return NextResponse.json({ error: "unknown memory" }, { status: 404 });
    return json({ state: "succeeded", result: entry.world, extras: entry.extras });
  }

  const provider = getWorldProvider(req.headers.get("x-worldlabs-key"));
  if (!provider) return NextResponse.json({ error: "no key" }, { status: 401 });

  // Objects and sound move on in the background; this poll reports where they are.
  const x = await readExtras(store, jobId);
  const extras = x ? toPublicExtras(x) : undefined;
  if (x && !extras?.done) after(() => progressExtras(jobId));

  try {
    const status = await provider.getStatus(jobId);
    if (status.state === "succeeded") await publishIfShared(jobId, status.result, extras);
    return json({ ...status, extras });
  } catch (error) {
    console.error("[world] status failed", error instanceof Error ? error.message : error);
    // Transient: the client keeps polling.
    return json({ state: "pending", extras });
  }
}

async function progressExtras(jobId: string) {
  try {
    const x = await advanceExtras(jobId, getExtrasDeps());
    const extras = x && toPublicExtras(x);
    if (x?.share && extras?.done) await updateGalleryExtras(getStore(), jobId, extras);
  } catch (error) {
    console.error("[extras] advance failed", error instanceof Error ? error.message : error);
  }
}

/**
 * The maker opted in when they started the job; publish the finished world once. With Jev
 * configured, it's screened first (from the scene description), and anything sensitive (a
 * child bathing, a hospital bed, a readable address…) waits for the owner's approval.
 */
async function publishIfShared(
  jobId: string,
  world: Extract<GenerationStatus, { state: "succeeded" }>["result"],
  extras: PublicExtras | undefined,
) {
  const store = getStore();
  const record = await store.get<JobRecord>(jobKey(jobId));
  if (!record?.share || record.published) return;
  const x = await readExtras(store, jobId);
  // Screen the scene before it's public: wait for the analysis if it's still running.
  if (x && x.analysis.state === "pending") return;
  const { judge } = getExtrasDeps();
  let heldReasons: string[] = [];
  if (judge) {
    heldReasons = x?.analysis.result
      ? await judge.sensitivity(x.analysis.result).catch(() => ["unscreened"])
      : ["unscreened"];
  }
  await store.set(jobKey(jobId), { ...record, published: true }, 60 * 60 * 24 * 2);
  await addToGallery(store, world, {
    jobId,
    extras,
    held: heldReasons.length > 0,
    heldReasons: heldReasons.length > 0 ? heldReasons : undefined,
  });
}

function json(body: StatusResponse) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
