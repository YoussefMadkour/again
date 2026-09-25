import { after, NextResponse } from "next/server";
import { accessPolicyFromEnv, authorizeGeneration, clientIp } from "@/lib/access";
import { getWorldProvider } from "@/lib/ai";
import { extrasAllowed, getExtrasDeps, getFileStorage } from "@/lib/ai/extras";
import { WorldLabsError } from "@/lib/ai/providers/real/worldlabs";
import { exploreOnly } from "@/lib/config";
import { type JobRecord, jobKey } from "@/lib/gallery";
import { randomId } from "@/lib/id";
import { advanceExtras, startExtras } from "@/lib/pipeline/extras";
import { getStore } from "@/lib/store";
import { ACCEPTED_PHOTO_TYPES, type AcceptedPhotoType, photoProblem } from "@/lib/upload";

export const runtime = "nodejs";

/**
 * Starts generating a world from one photograph. Returns a job to poll.
 * Form fields: photo, and either code (owner's key) or apiKey (the visitor's own). Optional share=1.
 */
export async function POST(req: Request) {
  if (exploreOnly()) {
    return NextResponse.json({ error: "new memories can't be made here" }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "no photo" }, { status: 400 });
  }
  const problem = photoProblem(photo);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const visitorKey = String(form?.get("apiKey") ?? "").trim() || null;
  const code = String(form?.get("code") ?? "").trim() || undefined;
  const share = form?.get("share") === "1";

  const provider = getWorldProvider(visitorKey);
  if (!provider) {
    return NextResponse.json({ error: "bring your own World Labs key" }, { status: 401 });
  }

  const store = getStore();
  const access = await authorizeGeneration(
    { code, ownKey: Boolean(visitorKey), ip: clientIp(req) },
    accessPolicyFromEnv(),
    store,
  );
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const bytes = new Uint8Array(await photo.arrayBuffer());
  try {
    const job = await provider.create({
      image: {
        bytes,
        extension: ACCEPTED_PHOTO_TYPES[photo.type as AcceptedPhotoType],
      },
      displayName: `again-${randomId(6)}`,
    });
    const record: JobRecord = { share };
    await store.set(jobKey(job.jobId), record, 60 * 60 * 24 * 2);
    if (extrasAllowed(access.usage)) {
      // Scene analysis, hero objects and sound start now, in parallel with the world.
      after(() => beginExtras(job.jobId, bytes, photo.type, share));
    }
    return NextResponse.json({ ...job, remaining: access.remaining });
  } catch (error) {
    await access.release();
    // Never log a visitor's key; WorldLabsError messages don't contain it.
    console.error("[world] create failed", error instanceof Error ? error.message : error);
    if (error instanceof WorldLabsError && (error.status === 401 || error.status === 403)) {
      return NextResponse.json({ error: "that World Labs key didn't work" }, { status: 401 });
    }
    if (error instanceof WorldLabsError && error.status === 402) {
      return NextResponse.json(
        {
          error: visitorKey ? "your World Labs account is out of credits" : "out of world credits",
        },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: "could not start this memory" }, { status: 502 });
  }
}

async function beginExtras(
  jobId: string,
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  share: boolean,
) {
  const store = getStore();
  let photoUrl: string | null = null;
  if (process.env.AI_MODE !== "real") {
    photoUrl = "mock://photo";
  } else {
    // The vision and 3D models fetch the photo by URL, so it needs a public, unguessable one.
    const storage = getFileStorage();
    photoUrl = storage
      ? await storage
          .upload(bytes, type, `photo-${randomId(8)}.${type.split("/")[1] ?? "jpg"}`)
          .catch((error: unknown) => {
            console.error(
              "[extras] photo upload failed",
              error instanceof Error ? error.message : error,
            );
            return null;
          })
      : null;
  }
  await startExtras(store, jobId, { photoUrl, share });
  await advanceExtras(jobId, getExtrasDeps()).catch((error: unknown) =>
    console.error("[extras] advance failed", error instanceof Error ? error.message : error),
  );
}
