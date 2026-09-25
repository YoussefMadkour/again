// Runs the real scene analysis → hero objects → sound pipeline for a gallery memory, and
// attaches the result to it. Spends fal (~$0.03 analysis + $0.375 per object) and ElevenLabs
// credits (40/s), plus ~$0.40 per person in 3D. Usage:
//   tsx --env-file=.env.local scripts/extras.ts <gallery_id> [--layers] [--people]
// --people gives people layers made before person models their 3D model (or retries one).
// --refit rebuilds finished person models from their paid-for results (free).
// --remesh remakes the hero objects with the current MESH_MODEL (default Hunyuan3D, $0.375
// each): furniture is dropped (it stays the world's), at most 6.
// --all-objects re-reads the photo for every object in the room and makes a 3D model of each
// (~$0.025 each; walls, windows, curtains and rugs stay part of the world).

import { LocalStorage } from "../lib/ai/providers/local-storage";
import { ElevenLabsAudioProvider } from "../lib/ai/providers/real/elevenlabs";
import {
  FalClient,
  FalMeshProvider,
  FalPersonProvider,
  FalSegmentProvider,
  FalStorage,
  FalVisionProvider,
  findFrames,
  isMeshModel,
} from "../lib/ai/providers/real/fal";
import { GeminiVisionProvider } from "../lib/ai/providers/real/gemini";
import { getGalleryEntry, updateGalleryExtras } from "../lib/gallery";
import { cropToBox } from "../lib/pipeline/crop";
import { advanceExtras, readExtras, startExtras, toPublicExtras } from "../lib/pipeline/extras";
import { cutoutFlat, cutoutPerson } from "../lib/pipeline/layers";
import { optimizeRemoteGlb } from "../lib/pipeline/optimize-glb";
import { fitPerson } from "../lib/pipeline/person";
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
    isMeshModel(process.env.MESH_MODEL) ? process.env.MESH_MODEL : "hunyuan3d-v3",
  ),
  audio: ELEVENLABS_API_KEY ? new ElevenLabsAudioProvider(ELEVENLABS_API_KEY, storage) : null,
  storage,
  crop: cropToBox,
  optimizeMesh: optimizeRemoteGlb,
  person3d: new FalPersonProvider(fal),
  fitPerson,
  findFrames: (photoUrl: string) => findFrames(fal, photoUrl),
  cutout: (
    photoUrl: string,
    layer: { kind: string; bbox: readonly [number, number, number, number] },
  ) =>
    layer.kind === "person"
      ? cutoutPerson(fal, photoUrl, layer.bbox)
      : cutoutFlat(photoUrl, layer.bbox),
};

// Resume if this memory already has extras (never pay twice); retry objects that failed.
const existing = await readExtras(store, jobId);
if (!existing) {
  // The world's own copy of the photo is already public.
  await startExtras(store, jobId, { photoUrl: entry.photoUrl, share: true });
} else {
  // --layers: re-read the photo (people boxes, every portrait) and remake its photo layers.
  if (process.argv.includes("--layers")) {
    existing.analysis = { state: "done", result: await deps.vision.analyze(entry.photoUrl) };
    existing.layers = null;
    existing.framesSearched = false;
  }
  for (const o of existing.objects ?? []) {
    if (o.state === "failed")
      Object.assign(o, { state: "pending", error: undefined, meshHandle: undefined });
  }
  if (process.argv.includes("--people")) {
    for (const l of existing.layers ?? []) {
      if (l.kind === "person" && l.bodyState !== "done" && l.bodyState !== "running") {
        Object.assign(l, { bodyState: "pending", bodyError: undefined, bodyHandle: undefined });
      }
    }
  }
  if (process.argv.includes("--all-objects")) {
    if (!GEMINI_API_KEY) throw new Error("--all-objects needs GEMINI_API_KEY");
    const thorough = new GeminiVisionProvider(
      GEMINI_API_KEY,
      process.env.GEMINI_MODEL || "gemini-flash-latest",
      true,
    );
    const analysis = await thorough.analyze(entry.photoUrl);
    const done = new Map((existing.objects ?? []).map((o) => [o.id, o]));
    const structural =
      /\b(wall|window|floor|ceiling|door|curtain|drape|rug|carpet|arch|column|molding|moulding|panel)/i;
    const planned = analysis.objects.filter(
      (o) =>
        o.bbox &&
        o.provenance === "observed" &&
        o.recommendedRepresentation !== "preserve" &&
        !structural.test(`${o.id} ${o.label}`),
    );
    // Keep what's already made (the same object, found again, has the same id or overlaps it).
    const overlaps = (a: readonly number[], b: readonly number[]) => {
      const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
      const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
      const smaller = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
      return smaller > 0 && (ix * iy) / smaller > 0.6;
    };
    const kept = [...done.values()].filter((o) => o.state === "done");
    const fresh = planned.filter(
      (o) => !done.has(o.id) && !kept.some((k) => o.bbox && overlaps(k.bbox, o.bbox)),
    );
    existing.objects = [
      ...kept,
      ...fresh.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        bbox: o.bbox as [number, number, number, number],
        state: "pending" as const,
      })),
    ];
    // The new objects join the analysis, for their evidence panels.
    existing.analysis = {
      state: "done",
      result: {
        ...analysis,
        objects: [
          ...(existing.analysis.result?.objects ?? []),
          ...analysis.objects.filter((o) => fresh.some((f) => f.id === o.id)),
        ],
      },
    };
    console.log("making", fresh.map((o) => o.id).join(", "));
  }
  if (process.argv.includes("--remesh")) {
    // Furniture stays the world's (single-view image-to-3D can't rebuild a chair's back or
    // what another chair hides); at most 6 objects.
    const furniture =
      /\b(chair|armchair|sofa|couch|settee|table|cabinet|bed|desk|dresser|bench|stool|wardrobe)/i;
    existing.objects = (existing.objects ?? [])
      .filter((o) => !furniture.test(`${o.id.replace(/-/g, " ")} ${o.label}`))
      .slice(0, 6);
    for (const o of existing.objects) {
      Object.assign(o, {
        state: "pending",
        error: undefined,
        meshHandle: undefined,
        glbUrl: undefined,
      });
    }
    console.log("remaking", existing.objects.map((o) => o.id).join(", "));
  }
  if (process.argv.includes("--refit")) {
    for (const l of existing.layers ?? []) {
      if (l.kind === "person" && l.bodyHandle) Object.assign(l, { bodyState: "running" });
    }
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
    "people:",
    (x.layers ?? [])
      .filter((l) => l.kind === "person")
      .map((l) => `${l.id}:${l.bodyState ?? "-"}${l.bodyError ? ` (${l.bodyError})` : ""}`)
      .join(" ") || "-",
  );
  if (pub.done) {
    await updateGalleryExtras(store, jobId, pub);
    console.log("attached to", `/?memory=${galleryId}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
