import { NextResponse } from "next/server";
import { getWorldProvider } from "@/lib/ai";
import type { GenerationStatus } from "@/lib/ai/types";
import { addToGallery, getGalleryEntry, type JobRecord, jobKey } from "@/lib/gallery";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** Mock job, World Labs operation, `world_<id>` (an existing world) or `gallery_<id>`. */
const JOB_ID = /^(mock_[0-9a-z]+_[0-9a-f]+|(world_)?[0-9a-f-]{36}|gallery_[0-9a-f]{16})$/i;

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  const store = getStore();

  if (jobId.startsWith("gallery_")) {
    const entry = await getGalleryEntry(store, jobId.slice("gallery_".length));
    if (!entry) return NextResponse.json({ error: "unknown memory" }, { status: 404 });
    return json({ state: "succeeded", result: entry.world });
  }

  const provider = getWorldProvider(req.headers.get("x-worldlabs-key"));
  if (!provider) return NextResponse.json({ error: "no key" }, { status: 401 });

  try {
    const status = await provider.getStatus(jobId);
    if (status.state === "succeeded") await publishIfShared(jobId, status.result);
    return json(status);
  } catch (error) {
    console.error("[world] status failed", error instanceof Error ? error.message : error);
    // Transient: the client keeps polling.
    return json({ state: "pending" });
  }
}

/** The maker opted in when they started the job; publish the finished world once. */
async function publishIfShared(
  jobId: string,
  world: Extract<GenerationStatus, { state: "succeeded" }>["result"],
) {
  const store = getStore();
  const record = await store.get<JobRecord>(jobKey(jobId));
  if (!record?.share || record.published) return;
  await store.set(jobKey(jobId), { ...record, published: true }, 60 * 60 * 24 * 2);
  await addToGallery(store, world);
}

function json(body: GenerationStatus) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
