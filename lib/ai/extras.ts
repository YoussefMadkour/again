import "server-only";
import { getConfig } from "@/lib/config";
import { cropToBox } from "@/lib/pipeline/crop";
import type { ExtrasDeps } from "@/lib/pipeline/extras";
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
  FalHunyuanProvider,
  FalSegmentProvider,
  FalStorage,
  FalVisionProvider,
} from "./providers/real/fal";
import type { FileStorage } from "./types";

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
      fal && new FalVisionProvider(fal, process.env.VISION_MODEL || "anthropic/claude-sonnet-5"),
    segment: fal && new FalSegmentProvider(fal),
    object3d: fal && new FalHunyuanProvider(fal),
    audio: elevenKey && storage ? new ElevenLabsAudioProvider(elevenKey, storage) : null,
    storage,
    crop: cropToBox,
  };
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
