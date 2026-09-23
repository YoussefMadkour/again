import "server-only";
import { z } from "zod";

const schema = z.discriminatedUnion("AI_MODE", [
  z.object({ AI_MODE: z.literal("mock") }),
  z.object({
    AI_MODE: z.literal("real"),
    WORLDLABS_API_KEY: z.string().min(1, "WORLDLABS_API_KEY is required when AI_MODE=real"),
    /** marble-1.1 (1,580 credits per image world) or marble-1.0-draft (230) for development. */
    WORLDLABS_MODEL: z
      .enum(["marble-1.1", "marble-1.1-plus", "marble-1.0", "marble-1.0-draft"])
      .default("marble-1.1"),
  }),
]);

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/** Server-only. Mock mode ignores any real keys that happen to be set. */
export function getConfig(): Config {
  if (cached) return cached;
  const mode = process.env.AI_MODE === "real" ? "real" : "mock";
  const parsed = schema.safeParse({ ...process.env, AI_MODE: mode });
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  cached = parsed.data;
  return cached;
}
