import "server-only";
import { getConfig } from "@/lib/config";
import { cropToBox } from "@/lib/pipeline/crop";
import type { ExtrasDeps } from "@/lib/pipeline/extras";
import { cutoutFlat, cutoutPerson } from "@/lib/pipeline/layers";
import { optimizeRemoteGlb } from "@/lib/pipeline/optimize-glb";
import { getStore } from "@/lib/store";
import { LocalStorage } from "./providers/local-storage";
import {
  MockAudioProvider,
  MockObject3DProvider,
  MockSegmentProvider,
  MockVisionProvider,
} from "./providers/mock/extras";
import { ElevenLabsAudioProvider } from "./providers/real/elevenlabs";
import {
  FalClient,
  FalMeshProvider,
  FalSegmentProvider,
  FalStorage,
  FalVisionProvider,
  findFrames,
  isMeshModel,
} from "./providers/real/fal";
import { GeminiVisionProvider } from "./providers/real/gemini";
import { JevJudge } from "./providers/real/jev";
import type { FileStorage, VisionProvider } from "./types";

/**
 * Providers for the scene analysis, hero objects and sound. A missing key turns that part
 * off (its steps are "skipped"); the world never depends on any of it.
 */
export function getExtrasDeps(): ExtrasDeps {
  const config = getConfig();
  const store = getStore();
  if (config.AI_MODE === "mock") {
    return {
      store,
      vision: new MockVisionProvider(),
      segment: new MockSegmentProvider(),
      object3d: new MockObject3DProvider(),
      audio: new MockAudioProvider(),
      storage: null,
      crop: cropToBox,
    };
  }
  const falKey = process.env.FAL_KEY;
  const fal = falKey ? new FalClient(falKey) : null;
  const storage = getFileStorage();
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  return {
    store,
    vision:
      fal && new FalVisionProvider(fal, process.env.VISION_MODEL || "google/gemini-2.5-flash"),
    segment: fal && new FalSegmentProvider(fal),
    object3d: fal && new FalMeshProvider(fal, meshModel()),
    audio: elevenKey && storage ? new ElevenLabsAudioProvider(elevenKey, storage) : null,
    storage,
    judge: process.env.TYPESAFE_API_KEY ? new JevJudge(process.env.TYPESAFE_API_KEY) : null,
    crop: cropToBox,
    optimizeMesh: optimizeRemoteGlb,
    findFrames: fal ? (photoUrl) => findFrames(fal, photoUrl) : undefined,
    cutout: fal
      ? (photoUrl, layer) =>
          layer.kind === "person"
            ? cutoutPerson(fal, photoUrl, layer.bbox)
            : cutoutFlat(photoUrl, layer.bbox)
      : undefined,
  };
}

/** MESH_MODEL=trellis (default, $0.02) | trellis-2 ($0.25) | hunyuan3d-v3 ($0.375). */
function meshModel() {
  const name = process.env.MESH_MODEL;
  return isMeshModel(name) ? name : "trellis";
}

/**
 * Gemini direct when there's a Google AI Studio key (it takes the photo inline and boxes
 * objects well), else a vision model through fal. VISION_PROVIDER=fal|gemini forces one.
 */
function visionProvider(fal: FalClient | null): VisionProvider | null {
  const gemini = process.env.GEMINI_API_KEY;
  const choice = process.env.VISION_PROVIDER ?? (gemini ? "gemini" : "fal");
  if (choice === "gemini" && gemini) {
    return new GeminiVisionProvider(gemini, process.env.GEMINI_MODEL || "gemini-flash-latest");
  }
  return fal && new FalVisionProvider(fal, process.env.VISION_MODEL || "google/gemini-2.5-flash");
}

/**
 * Where photos, crops and sounds go. fal's CDN by default (its models can fetch from it);
 * STORAGE=local keeps files on this machine (development; remote models can't read them).
 */
export function getFileStorage(): FileStorage | null {
  if (process.env.STORAGE === "local" && !process.env.VERCEL) return new LocalStorage();
  return process.env.FAL_KEY ? new FalStorage(process.env.FAL_KEY) : null;
}

/** Visitors on their own World Labs key get the world; extras run on the owner's accounts. */
export function extrasAllowed(usage: "own-key" | "code" | "open") {
  return usage !== "own-key" || process.env.EXTRAS_FOR_OWN_KEYS === "true";
}
