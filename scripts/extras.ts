// Runs the real scene analysis → hero objects → sound pipeline for a gallery memory, and
// attaches the result to it. Spends fal (~$0.03 analysis + $0.375 per object) and ElevenLabs
// credits (40/s). Usage: tsx --env-file=.env.local scripts/extras.ts <gallery_id>

import { LocalStorage } from "../lib/ai/providers/local-storage";
import { ElevenLabsAudioProvider } from "../lib/ai/providers/real/elevenlabs";
import {
  FalClient,
  FalMeshProvider,
  FalSegmentProvider,
  FalStorage,
  FalVisionProvider,
  isMeshModel,
} from "../lib/ai/providers/real/fal";
import { GeminiVisionProvider } from "../lib/ai/providers/real/gemini";
import { getGalleryEntry, updateGalleryExtras } from "../lib/gallery";
import { cropToBox } from "../lib/pipeline/crop";
import { advanceExtras, readExtras, startExtras, toPublicExtras } from "../lib/pipeline/extras";
import { optimizeRemoteGlb } from "../lib/pipeline/optimize-glb";
import { getStore } from "../lib/store";

const [galleryId] = process.argv.slice(2);
const { FAL_KEY, ELEVENLABS_API_KEY, GEMINI_API_KEY } = process.env;
if (!galleryId || !FAL_KEY) throw new Error("usage: extras.ts <gallery_id> (needs FAL_KEY)");

const store = getStore();
const entry = await getGalleryEntry(store, galleryId);
if (!entry) throw new Error(`no gallery entry ${galleryId}`);
const jobId = entry.jobId ?? `gallery-${galleryId}`;
if (!entry.jobId) {
  // Older entries have no job; give them one so the result can be attached.
  const { listGallery } = await import("../lib/gallery");
  const all = await listGallery(store);
  const e = all.find((x) => x.id === galleryId);
  if (e) e.jobId = jobId;
  await store.set("gallery", all);
}

const fal = new FalClient(FAL_KEY);
// Same choices as the app: Gemini for vision when there's a key, local files with STORAGE=local.
const storage = process.env.STORAGE === "local" ? new LocalStorage() : new FalStorage(FAL_KEY);
const deps = {
  store,
  vision: GEMINI_API_KEY
    ? new GeminiVisionProvider(GEMINI_API_KEY, process.env.GEMINI_MODEL || "gemini-flash-latest")
    : new FalVisionProvider(fal, process.env.VISION_MODEL || "google/gemini-2.5-flash"),
  segment: new FalSegmentProvider(fal),
  object3d: new FalMeshProvider(
    fal,
    isMeshModel(process.env.MESH_MODEL) ? process.env.MESH_MODEL : "trellis",
  ),
  audio: ELEVENLABS_API_KEY ? new ElevenLabsAudioProvider(ELEVENLABS_API_KEY, storage) : null,
  storage,
  crop: cropToBox,
  optimizeMesh: optimizeRemoteGlb,
};

// Resume if this memory already has extras (never pay twice); retry objects that failed.
const existing = await readExtras(store, jobId);
if (!existing) {
  // The world's own copy of the photo is already public.
  await startExtras(store, jobId, { photoUrl: entry.photoUrl, share: true });
} else {
  for (const o of existing.objects ?? []) {
    if (o.state === "failed")
      Object.assign(o, { state: "pending", error: undefined, meshHandle: undefined });
  }
  await store.set(`extras:${jobId}`, existing, 60 * 60 * 24 * 7);
}
for (let i = 0; ; i++) {
  const x = await advanceExtras(jobId, deps);
  if (!x) throw new Error("extras vanished");
  const pub = toPublicExtras(x);
  console.log(
    `${i * 10}s analysis:${x.analysis.state}${x.analysis.error ? ` (${x.analysis.error})` : ""}`,
    "objects:",
    pub.objects.map((o) => `${o.id}:${o.state}`).join(" ") || "-",
    "sounds:",
    pub.sounds.map((s) => `${s.kind}:${s.state}`).join(" ") || "-",
  );
  if (pub.done) {
    await updateGalleryExtras(store, jobId, pub);
    console.log("attached to", `/?memory=${galleryId}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
