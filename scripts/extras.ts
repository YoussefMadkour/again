// Runs the real scene analysis → hero objects → sound pipeline for a gallery memory, and
// attaches the result to it. Spends fal (~$0.03 analysis + $0.375 per object) and ElevenLabs
// credits (40/s). Usage: tsx --env-file=.env.local scripts/extras.ts <gallery_id>

import { ElevenLabsAudioProvider } from "../lib/ai/providers/real/elevenlabs";
import {
  FalClient,
  FalHunyuanProvider,
  FalSegmentProvider,
  FalStorage,
  FalVisionProvider,
} from "../lib/ai/providers/real/fal";
import { getGalleryEntry, updateGalleryExtras } from "../lib/gallery";
import { cropToBox } from "../lib/pipeline/crop";
import { advanceExtras, startExtras, toPublicExtras } from "../lib/pipeline/extras";
import { getStore } from "../lib/store";

const [galleryId] = process.argv.slice(2);
const { FAL_KEY, ELEVENLABS_API_KEY } = process.env;
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
const storage = new FalStorage(FAL_KEY);
const deps = {
  store,
  vision: new FalVisionProvider(fal, process.env.VISION_MODEL || "anthropic/claude-sonnet-5"),
  segment: new FalSegmentProvider(fal),
  object3d: new FalHunyuanProvider(fal),
  audio: ELEVENLABS_API_KEY ? new ElevenLabsAudioProvider(ELEVENLABS_API_KEY, storage) : null,
  storage,
  crop: cropToBox,
};

// The world's own copy of the photo is already public.
await startExtras(store, jobId, { photoUrl: entry.photoUrl, share: true });
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
