/**
 * Everything a memory gets beyond its world: the scene manifest, up to three interactive hero
 * objects, and its sound. Runs alongside world generation.
 *
 * No workflow engine: every provider here is either quick (vision, segmentation, sound) or has
 * its own queue (Hunyuan3D), so the state lives in the store and `advanceExtras` moves it
 * forward. It runs right after the upload and again on each status poll, under a lock, so a
 * paid step never runs twice. Each step fails on its own; none of them can block the world.
 */
import type {
  AudioProvider,
  FileStorage,
  Judge,
  Object3DProvider,
  ObjectDecision,
  SegmentProvider,
  VisionProvider,
} from "@/lib/ai/types";
import { selectHeroObjects } from "@/lib/analysis/hero";
import type { BoundingBox, MemoryAnalysis } from "@/lib/analysis/schema";
import { randomId } from "@/lib/id";
import type { Store } from "@/lib/store";

export type StepState = "pending" | "running" | "done" | "failed" | "skipped";

export interface HeroObjectState {
  id: string;
  label: string;
  description: string;
  /** Where the object is in the photo (refined by segmentation when possible). */
  bbox: BoundingBox;
  state: StepState;
  error?: string;
  cropUrl?: string;
  meshHandle?: string;
  glbUrl?: string;
}

export interface SoundState {
  id: string;
  kind: "ambient" | "positional";
  description: string;
  prompt: string;
  /** Positional sounds come from an object in the photo. */
  objectId?: string;
  bbox?: BoundingBox;
  state: StepState;
  error?: string;
  url?: string;
}

/** The photo's own pixels, for what the world model can't rebuild (see layers.ts). */
export interface LayerState {
  id: string;
  kind: "person" | "flat";
  label: string;
  bbox: BoundingBox;
  state: StepState;
  error?: string;
  /** Transparent PNG. */
  url?: string;
  /** The region of the photo the PNG covers (the box plus padding). Draw it there. */
  imageBox?: BoundingBox;
}

export interface Extras {
  photoUrl: string | null;
  share: boolean;
  analysis: { state: StepState; result?: MemoryAnalysis; error?: string };
  /** Null until the analysis has been read. */
  objects: HeroObjectState[] | null;
  sounds: SoundState[] | null;
  /** Undefined on memories made before layers existed. */
  layers?: LayerState[] | null;
  /** Jev's per-object calls, when it made them (kept for transparency and debugging). */
  decisions?: ObjectDecision[];
  /** Whether the photo has been searched for framed pictures the vision model missed. */
  framesSearched?: boolean;
  createdAt: string;
}

/** What the browser gets. */
export interface PublicExtras {
  done: boolean;
  scene?: Pick<
    MemoryAnalysis,
    "sceneType" | "estimatedEra" | "description" | "mood" | "uncertainties"
  >;
  objects: Pick<HeroObjectState, "id" | "label" | "description" | "bbox" | "glbUrl" | "state">[];
  sounds: Pick<SoundState, "id" | "kind" | "description" | "objectId" | "bbox" | "url" | "state">[];
  layers?: Pick<LayerState, "id" | "kind" | "label" | "bbox" | "imageBox" | "url" | "state">[];
}

export interface ExtrasDeps {
  store: Store;
  vision: VisionProvider | null;
  segment: SegmentProvider | null;
  object3d: Object3DProvider | null;
  audio: AudioProvider | null;
  storage: FileStorage | null;
  /** Calibrated judgments (Jev). Without it, the vision model's own calls are used. */
  judge?: Judge | null;
  /** Crops the photo to a box (with padding) and returns image bytes. */
  crop: (photoUrl: string, bbox: BoundingBox) => Promise<Uint8Array<ArrayBuffer>>;
  /** Finds framed photographs/pictures in the photo (boxes with confidence). */
  findFrames?: (photoUrl: string) => Promise<{ box: BoundingBox; score: number }[]>;
  /** Cuts a photo layer out of the photograph as a transparent PNG. */
  cutout?: (
    photoUrl: string,
    layer: LayerState,
  ) => Promise<{ bytes: Uint8Array<ArrayBuffer>; box: BoundingBox }>;
  /** Compresses a finished mesh for the browser; null when it wouldn't help. */
  optimizeMesh?: (glbUrl: string) => Promise<Uint8Array<ArrayBuffer> | null>;
}

export const LAYER_BUDGET = { people: 3, flat: 8 };

export const SOUND_BUDGET = {
  ambientSeconds: 15,
  positionalSeconds: 6,
  maxAmbient: 1,
  maxPositional: 2,
};

const TTL = 60 * 60 * 24 * 7;
const LOCK_S = 120;
const key = (jobId: string) => `extras:${jobId}`;

export async function startExtras(
  store: Store,
  jobId: string,
  opts: { photoUrl: string | null; share: boolean },
) {
  const extras: Extras = {
    photoUrl: opts.photoUrl,
    share: opts.share,
    analysis: { state: opts.photoUrl ? "pending" : "skipped" },
    objects: null,
    sounds: null,
    layers: null,
    createdAt: new Date().toISOString(),
  };
  await store.set(key(jobId), extras, TTL);
}

export async function readExtras(store: Store, jobId: string): Promise<Extras | null> {
  return store.get<Extras>(key(jobId));
}

/** Moves the pipeline forward as far as it can right now. Safe to call concurrently. */
export async function advanceExtras(jobId: string, deps: ExtrasDeps): Promise<Extras | null> {
  const { store } = deps;
  const lock = `lock:${key(jobId)}`;
  if (!(await store.claim(lock, LOCK_S))) return readExtras(store, jobId);
  try {
    const x = await readExtras(store, jobId);
    if (!x) return null;
    const save = () => store.set(key(jobId), x, TTL);

    // 1. Read the photograph.
    if (x.analysis.state === "pending" && x.photoUrl) {
      if (!deps.vision) {
        x.analysis = { state: "skipped" };
      } else {
        try {
          x.analysis = { state: "done", result: await deps.vision.analyze(x.photoUrl) };
        } catch (error) {
          x.analysis = { state: "failed", error: message(error) };
        }
      }
      await save();
    }

    // 2. Plan hero objects and sounds from it.
    if (x.analysis.state !== "pending" && x.objects === null) {
      const analysis = x.analysis.result;
      if (analysis && deps.judge && !x.decisions) {
        x.decisions = await deps.judge.representations(analysis).catch(() => undefined);
      }
      x.objects = analysis ? planObjects(analysis, x.decisions) : [];
      x.sounds = analysis ? await guardVoices(planSounds(analysis), deps.judge) : [];
      x.layers = analysis ? planLayers(analysis, x.decisions) : [];
      await save();
    }
    if (x.analysis.state !== "pending" && x.layers == null) {
      x.layers = x.analysis.result ? planLayers(x.analysis.result, x.decisions) : [];
      await save();
    }

    // 2b. Framed pictures the vision model didn't list (small ones on the walls, mostly).
    if (x.layers && !x.framesSearched && x.photoUrl && deps.findFrames) {
      const found = await deps.findFrames(x.photoUrl).catch(() => []);
      x.layers.push(...extraFrames(found, x.layers, x.objects ?? []));
      x.framesSearched = true;
      await save();
    }

    // 3. Sounds and objects, in parallel.
    await Promise.all([
      ...(x.sounds ?? []).map((s) => advanceSound(s, deps)),
      ...(x.objects ?? []).map((o) => advanceObject(o, x.photoUrl, deps)),
      ...(x.layers ?? []).map((l) => advanceLayer(l, x.photoUrl, deps)),
    ]);
    await save();
    return x;
  } finally {
    await store.del(lock);
  }
}

export function planObjects(
  analysis: MemoryAnalysis,
  decisions?: ObjectDecision[],
): HeroObjectState[] {
  return selectHeroObjects(analysis.objects, decisions).map((o) => ({
    id: o.id,
    label: o.label,
    description: o.description,
    bbox: o.bbox as BoundingBox,
    state: "pending",
  }));
}

export function planSounds(analysis: MemoryAnalysis): SoundState[] {
  const byId = new Map(analysis.objects.map((o) => [o.id, o]));
  const ambient = analysis.audio.globalAmbience.slice(0, SOUND_BUDGET.maxAmbient).map(
    (a): SoundState => ({
      id: `ambient-${randomId(4)}`,
      kind: "ambient",
      description: a.description,
      prompt: a.prompt,
      state: "pending",
    }),
  );
  const positional = analysis.audio.positionalSources
    // A positional sound needs a place in the photo to come from.
    .filter((p) => p.object && byId.get(p.object)?.bbox)
    .slice(0, SOUND_BUDGET.maxPositional)
    .map(
      (p): SoundState => ({
        id: `sound-${randomId(4)}`,
        kind: "positional",
        description: p.description,
        prompt: p.prompt,
        objectId: p.object,
        bbox: byId.get(p.object as string)?.bbox,
        state: "pending",
      }),
    );
  return [...ambient, ...positional];
}

/** Voices of the people in a photo are never made up: such sounds are dropped unmade. */
export const VOICE_LIMIT = 0.5;

async function guardVoices(sounds: SoundState[], judge?: Judge | null): Promise<SoundState[]> {
  if (!judge || sounds.length === 0) return sounds;
  const voiced = await judge.voices(sounds.map((s) => s.prompt)).catch(() => null);
  if (!voiced) return sounds;
  return sounds.map((s, i) =>
    voiced[i] > VOICE_LIMIT ? { ...s, state: "skipped", error: "would contain a voice" } : s,
  );
}

/** People (confidently seen, with a box) and flat things whose exact pixels matter. */
export function planLayers(analysis: MemoryAnalysis, decisions?: ObjectDecision[]): LayerState[] {
  const decided = new Map((decisions ?? []).map((d) => [d.id, d]));
  const isFlat = (o: MemoryAnalysis["objects"][number]) => {
    const d = decided.get(o.id);
    return d
      ? d.representation === "photo" && d.confidence >= 0.4
      : o.recommendedRepresentation === "preserve";
  };
  const people = analysis.people
    .filter((p) => p.bbox && p.confidence >= 0.5)
    .slice(0, LAYER_BUDGET.people)
    .map(
      (p): LayerState => ({
        id: `layer-${p.id}`,
        kind: "person",
        label: "person",
        bbox: p.bbox as BoundingBox,
        state: "pending",
      }),
    );
  const flat = analysis.objects
    .filter((o) => o.bbox && o.provenance === "observed" && isFlat(o))
    .slice(0, LAYER_BUDGET.flat)
    .map(
      (o): LayerState => ({
        id: `layer-${o.id}`,
        kind: "flat",
        label: o.label,
        bbox: o.bbox as BoundingBox,
        state: "pending",
      }),
    );
  return [...people, ...flat];
}

const MIN_FRAME_SCORE = 0.6;
const MIN_FRAME_AREA = 0.0006;
const MAX_FRAME_AREA = 0.1;

/** New flat layers for frames that nothing else covers yet, within the layer budget. */
export function extraFrames(
  found: { box: BoundingBox; score: number }[],
  layers: LayerState[],
  objects: HeroObjectState[],
): LayerState[] {
  // Not people's boxes: a portrait on the wall behind someone is still its own layer.
  const taken = [
    ...layers.filter((l) => l.kind === "flat").map((l) => l.bbox),
    ...objects.map((o) => o.bbox),
  ];
  let room = LAYER_BUDGET.flat - layers.filter((l) => l.kind === "flat").length;
  const added: LayerState[] = [];
  for (const { box, score } of [...found].sort((a, b) => b.score - a.score)) {
    if (room <= 0) break;
    const area = (box[2] - box[0]) * (box[3] - box[1]);
    if (score < MIN_FRAME_SCORE || area < MIN_FRAME_AREA || area > MAX_FRAME_AREA) continue;
    if (taken.some((t) => overlap(t, box) > 0.3)) continue;
    taken.push(box);
    added.push({
      id: `layer-frame-${added.length + 1}`,
      kind: "flat",
      label: "framed photograph",
      bbox: box,
      state: "pending",
    });
    room--;
  }
  return added;
}

/** Share of the smaller box covered by the other (catches a frame inside a person's box). */
function overlap(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const smaller = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  return smaller > 0 ? (ix * iy) / smaller : 0;
}

async function advanceLayer(l: LayerState, photoUrl: string | null, deps: ExtrasDeps) {
  if (l.state !== "pending") return;
  if (!deps.cutout || !deps.storage || !photoUrl) {
    l.state = "skipped";
    return;
  }
  try {
    const cut = await deps.cutout(photoUrl, l);
    l.url = await deps.storage.upload(cut.bytes, "image/png", `${l.id}-${randomId(6)}.png`);
    l.imageBox = cut.box;
    l.state = "done";
  } catch (error) {
    l.state = "failed";
    l.error = message(error);
  }
}

async function advanceSound(s: SoundState, deps: ExtrasDeps) {
  if (s.state !== "pending") return;
  if (!deps.audio) {
    s.state = "skipped";
    return;
  }
  try {
    s.url = await deps.audio.generate({
      prompt: s.prompt,
      durationSeconds:
        s.kind === "ambient" ? SOUND_BUDGET.ambientSeconds : SOUND_BUDGET.positionalSeconds,
      loop: true,
    });
    s.state = "done";
  } catch (error) {
    s.state = "failed";
    s.error = message(error);
  }
}

async function advanceObject(o: HeroObjectState, photoUrl: string | null, deps: ExtrasDeps) {
  try {
    if (o.state === "pending") {
      if (!deps.object3d || !photoUrl) {
        o.state = "skipped";
        return;
      }
      // A tighter box makes a cleaner crop; the vision model's guess is the fallback.
      if (deps.segment) {
        const refined = await deps.segment.refineBox(photoUrl, o.label, o.bbox).catch(() => null);
        if (refined) o.bbox = refined;
      }
      if (deps.storage) {
        const bytes = await deps.crop(photoUrl, o.bbox);
        o.cropUrl = await deps.storage.upload(
          bytes,
          "image/jpeg",
          `crop-${o.id}-${randomId(6)}.jpg`,
        );
      }
      o.meshHandle = await deps.object3d.submit(o.cropUrl ?? photoUrl, o.label);
      o.state = "running";
      return;
    }
    if (o.state === "running" && o.meshHandle && deps.object3d) {
      const status = await deps.object3d.poll(o.meshHandle);
      if (status.state === "succeeded") {
        o.glbUrl = await compressed(status.glbUrl, o.id, deps);
        o.state = "done";
      } else if (status.state === "failed") {
        o.state = "failed";
        o.error = status.error;
      }
    }
  } catch (error) {
    o.state = "failed";
    o.error = message(error);
  }
}

/** Generated meshes ship uncompressed textures; a failed compression keeps the original. */
async function compressed(glbUrl: string, id: string, deps: ExtrasDeps): Promise<string> {
  if (!deps.optimizeMesh || !deps.storage) return glbUrl;
  try {
    const bytes = await deps.optimizeMesh(glbUrl);
    if (!bytes) return glbUrl;
    return await deps.storage.upload(bytes, "model/gltf-binary", `mesh-${id}-${randomId(6)}.glb`);
  } catch {
    return glbUrl;
  }
}

const settled = (s: StepState) => s === "done" || s === "failed" || s === "skipped";

export function toPublicExtras(x: Extras): PublicExtras {
  const a = x.analysis.result;
  return {
    done:
      settled(x.analysis.state) &&
      x.objects !== null &&
      x.objects.every((o) => settled(o.state)) &&
      (x.sounds ?? []).every((s) => settled(s.state)) &&
      (x.layers ?? []).every((l) => settled(l.state)),
    scene: a && {
      sceneType: a.sceneType,
      estimatedEra: a.estimatedEra,
      description: a.description,
      mood: a.mood,
      uncertainties: a.uncertainties,
    },
    objects: (x.objects ?? []).map(({ id, label, description, bbox, glbUrl, state }) => ({
      id,
      label,
      description,
      bbox,
      glbUrl,
      state,
    })),
    layers: (x.layers ?? []).map(({ id, kind, label, bbox, imageBox, url, state }) => ({
      id,
      kind,
      label,
      bbox,
      imageBox,
      url,
      state,
    })),
    sounds: (x.sounds ?? []).map(({ id, kind, description, objectId, bbox, url, state }) => ({
      id,
      kind,
      description,
      objectId,
      bbox,
      url,
      state,
    })),
  };
}

function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
