import type { GenerationJob, GenerationStatus, WorldProvider } from "@/lib/ai/types";
import { randomId } from "@/lib/id";

/** Long enough to see the processing copy cycle, short enough to iterate on. */
export const MOCK_GENERATION_MS = process.env.NODE_ENV === "test" ? 0 : 9000;

/**
 * Pretends to generate a world and returns the demo splat. Stateless: the job id encodes
 * when it was created, so it survives dev-server reloads.
 */
export class MockWorldProvider implements WorldProvider {
  constructor(private readonly now: () => number = Date.now) {}

  async create(): Promise<GenerationJob> {
    return { jobId: `mock_${this.now().toString(36)}_${randomId(8)}` };
  }

  async getStatus(jobId: string): Promise<GenerationStatus> {
    const match = /^mock_([0-9a-z]+)_[\w-]+$/.exec(jobId);
    if (!match) return { state: "failed", error: "unknown job" };
    const createdAt = Number.parseInt(match[1], 36);
    if (this.now() - createdAt < MOCK_GENERATION_MS) return { state: "pending" };
    return {
      state: "succeeded",
      result: {
        splatUrl: "/demo/painted-bedroom.spz",
        sourcePhotoUrl: "/demo/photo.jpg",
        format: "spz",
        metricScale: 1,
        metadata: { provider: "mock", generatedAt: new Date(createdAt).toISOString() },
      },
    };
  }
}
