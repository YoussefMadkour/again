import { NextResponse } from "next/server";
import { getWorldProvider } from "@/lib/ai";
import { WorldLabsError } from "@/lib/ai/providers/real/worldlabs";
import { randomId } from "@/lib/id";
import { ACCEPTED_PHOTO_TYPES, type AcceptedPhotoType, photoProblem } from "@/lib/upload";

export const runtime = "nodejs";

/** Starts generating a world from one photograph. Returns a job to poll. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "no photo" }, { status: 400 });
  }
  const problem = photoProblem(photo);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const job = await getWorldProvider().create({
      image: {
        bytes: new Uint8Array(await photo.arrayBuffer()),
        extension: ACCEPTED_PHOTO_TYPES[photo.type as AcceptedPhotoType],
      },
      displayName: `again-${randomId(6)}`,
    });
    return NextResponse.json(job);
  } catch (error) {
    console.error("[world] create failed", error);
    const outOfCredits = error instanceof WorldLabsError && error.status === 402;
    return NextResponse.json(
      { error: outOfCredits ? "out of world credits" : "could not start this memory" },
      { status: outOfCredits ? 402 : 502 },
    );
  }
}
