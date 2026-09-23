import { NextResponse } from "next/server";
import { getWorldProvider } from "@/lib/ai";

export const runtime = "nodejs";

/** Mock job, World Labs operation, or `world_<id>` for an existing world. */
const JOB_ID = /^(mock_[0-9a-z]+_[0-9a-f]+|(world_)?[0-9a-f-]{36})$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  try {
    const status = await getWorldProvider().getStatus(jobId);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[world] status failed", error);
    // Transient: the client keeps polling.
    return NextResponse.json({ state: "pending" }, { status: 200 });
  }
}
