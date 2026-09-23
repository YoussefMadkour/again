import type { BoundingBox, MemoryAnalysis } from "@/lib/analysis/schema";

/**
 * Every paid external service sits behind one of these interfaces, with a mock and a real
 * implementation. Only the world provider exists so far (Milestone 2).
 */

export interface WorldGenerationInput {
  image: {
    bytes: Uint8Array<ArrayBuffer>;
    /** File extension without the dot: jpg, png, webp. */
    extension: string;
  };
  /** Optional text guidance. Omitted, World Labs captions the image itself. */
  prompt?: string;
  /** Shown in the provider's dashboard. Never contains user data. */
  displayName: string;
}

export interface GenerationJob {
  jobId: string;
}

export interface WorldResult {
  /** Desktop-quality splat. */
  splatUrl: string;
  /** Lighter splat for mobile, when the provider has one. */
  splatUrlLowRes?: string;
  /** Full-resolution splat (several times larger), swapped in on desktop once loaded. */
  splatUrlHighRes?: string;
  format: "spz";
  /** Multiply splat units by this to get meters. */
  metricScale: number;
  /** A render of the world, for previews. */
  thumbnailUrl?: string;
  /** The photograph the world was made from, as the provider stored it. */
  sourcePhotoUrl?: string;
  /** Equirectangular panorama the world was built from, used to find the photo's camera. */
  panoUrl?: string;
  /** The photo's camera, when the provider knows it (skips calibration). */
  camera?: { fov: number; pitch: number; yaw: number };
  metadata: {
    provider: string;
    worldId?: string;
    caption?: string;
    generatedAt: string;
  };
}

export type GenerationStatus =
  | { state: "pending"; progress?: string }
  | { state: "succeeded"; result: WorldResult }
  | { state: "failed"; error: string };

export interface WorldProvider {
  create(input: WorldGenerationInput): Promise<GenerationJob>;
  getStatus(jobId: string): Promise<GenerationStatus>;
}

// --- Milestone 3: scene analysis, hero objects, audio. ---

export interface VisionProvider {
  /** Reads the photograph into a scene manifest. `photoUrl` must be publicly fetchable. */
  analyze(photoUrl: string): Promise<MemoryAnalysis>;
}

export interface SegmentProvider {
  /** A tighter box for `label` near `hint`, or null when it can't find it. */
  refineBox(photoUrl: string, label: string, hint: BoundingBox): Promise<BoundingBox | null>;
}

export type MeshStatus =
  | { state: "pending" }
  | { state: "succeeded"; glbUrl: string }
  | { state: "failed"; error: string };

export interface Object3DProvider {
  /** Starts image-to-3D on an object crop. `label` names the object (to cut it out). */
  submit(imageUrl: string, label?: string): Promise<string>;
  poll(handle: string): Promise<MeshStatus>;
}

export interface AudioGenerationInput {
  prompt: string;
  durationSeconds: number;
  /** Seamless loop, for ambience beds. */
  loop: boolean;
}

export interface AudioProvider {
  /** Returns a public URL of the generated sound. */
  generate(input: AudioGenerationInput): Promise<string>;
}

export interface FileStorage {
  /** Stores bytes and returns a public, unguessable URL. */
  upload(bytes: Uint8Array<ArrayBuffer>, contentType: string, fileName: string): Promise<string>;
}
