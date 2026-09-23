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
  format: "spz";
  /** Multiply splat units by this to get meters. */
  metricScale: number;
  /** A render of the world, for previews. */
  thumbnailUrl?: string;
  /** The photograph the world was made from, as the provider stored it. */
  sourcePhotoUrl?: string;
  /** Equirectangular panorama the world was built from, used to find the photo's camera. */
  panoUrl?: string;
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
