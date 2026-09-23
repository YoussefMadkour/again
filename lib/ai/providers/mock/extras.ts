import type {
  AudioGenerationInput,
  AudioProvider,
  MeshStatus,
  Object3DProvider,
  SegmentProvider,
  VisionProvider,
} from "@/lib/ai/types";
import type { BoundingBox, MemoryAnalysis } from "@/lib/analysis/schema";
import { DEMO_ANALYSIS } from "@/lib/demo/analysis";

const DELAY = process.env.NODE_ENV === "test" ? 0 : 1500;
const MESH_MS = process.env.NODE_ENV === "test" ? 0 : 6000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The demo room's manifest, whatever the photo. */
export class MockVisionProvider implements VisionProvider {
  async analyze(): Promise<MemoryAnalysis> {
    await wait(DELAY);
    return structuredClone(DEMO_ANALYSIS);
  }
}

export class MockSegmentProvider implements SegmentProvider {
  async refineBox(_url: string, _label: string, hint: BoundingBox) {
    return hint;
  }
}

/** The demo's hero object, "ready" a few seconds after it's asked for. */
export class MockObject3DProvider implements Object3DProvider {
  async submit() {
    return String(Date.now());
  }
  async poll(handle: string): Promise<MeshStatus> {
    return Date.now() - Number(handle) < MESH_MS
      ? { state: "pending" }
      : { state: "succeeded", glbUrl: "/demo/object.glb" };
  }
}

export class MockAudioProvider implements AudioProvider {
  async generate({ durationSeconds }: AudioGenerationInput) {
    await wait(DELAY);
    return durationSeconds > 10 ? "/demo/audio/ambient.mp3" : "/demo/audio/window.mp3";
  }
}
