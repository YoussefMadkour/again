import "server-only";
import { z } from "zod";

export const WORLD_MODELS = [
  "marble-1.1",
  "marble-1.1-plus",
  "marble-1.0",
  "marble-1.0-draft",
] as const;

const schema = z.discriminatedUnion("AI_MODE", [
  z.object({ AI_MODE: z.literal("mock") }),
  z.object({
    AI_MODE: z.literal("real"),
    /** The owner's key, used with access codes. Without it, only visitors' own keys work. */
    WORLDLABS_API_KEY: z.string().optional(),
    /** marble-1.1 (1,580 credits per image world) or marble-1.0-draft (230) for development. */
    WORLDLABS_MODEL: z.enum(WORLD_MODELS).default("marble-1.1"),
  }),
]);

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/** Server-only. Mock mode ignores any real keys that happen to be set. */
export function getConfig(): Config {
  if (cached) return cached;
  const mode = process.env.AI_MODE === "real" ? "real" : "mock";
  const parsed = schema.safeParse({
    ...process.env,
    AI_MODE: mode,
    WORLDLABS_API_KEY: process.env.WORLDLABS_API_KEY || undefined,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Safe to send to the browser. */
export function publicConfig() {
  const config = getConfig();
  return {
    mode: config.AI_MODE,
    ownerKey: config.AI_MODE === "mock" || Boolean(config.WORLDLABS_API_KEY),
    contactUrl: process.env.NEXT_PUBLIC_CONTACT_URL || null,
  };
}
