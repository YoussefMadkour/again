/**
 * The scene manifest: what the vision model read from the photograph.
 * Validated with zod because it comes from a model; numbers are clamped rather than rejected.
 */
import { z } from "zod";

const unit = z.coerce
  .number()
  .transform((n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0));

/** Normalized to the photo: [x0, y0, x1, y1], 0..1, origin top-left. */
export const BoundingBox = z
  .tuple([unit, unit, unit, unit])
  .transform(
    ([a, b, c, d]) => [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)] as const,
  )
  .refine(([x0, y0, x1, y1]) => x1 - x0 > 0.005 && y1 - y0 > 0.005, "empty box");
export type BoundingBox = readonly [number, number, number, number];

export const MemoryObject = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  // A bad box drops the box, not the object (or the whole analysis).
  bbox: BoundingBox.optional().catch(undefined),
  visibility: unit.default(0.5),
  importance: unit.default(0.3),
  interactionPotential: unit.default(0.3),
  meshFeasibility: unit.default(0.5),
  provenance: z.enum(["observed", "inferred"]).catch("observed"),
  recommendedRepresentation: z.enum(["splat", "mesh", "preserve"]).catch("splat"),
});
export type MemoryObject = z.infer<typeof MemoryObject>;

export const PersonObservation = z.object({
  id: z.string(),
  description: z.string(),
  /** Where the person is in the photo, so their real pixels can be shown near the viewpoint. */
  bbox: BoundingBox.optional().catch(undefined),
  visibility: z.enum(["full", "partial"]).catch("partial"),
  confidence: unit.default(0.5),
});

export const AudioSource = z.object({
  description: z.string().min(1),
  /** A sound-effect prompt, written for a text-to-sound model. */
  prompt: z.string().min(1),
});

export const PositionalAudioSource = AudioSource.extend({
  /** The object the sound comes from, by id. */
  object: z.string().optional(),
});

export const AudioPlan = z.object({
  globalAmbience: z.array(AudioSource).default([]),
  positionalSources: z.array(PositionalAudioSource).default([]),
});
export type AudioPlan = z.infer<typeof AudioPlan>;

export const MemoryAnalysis = z.object({
  sceneType: z.string().default("unknown"),
  estimatedEra: z.string().optional(),
  description: z.string().default(""),
  mood: z.string().default(""),
  environment: z
    .object({
      type: z.enum(["interior", "exterior", "mixed"]).catch("interior"),
      description: z.string().default(""),
    })
    .default({ type: "interior", description: "" }),
  objects: z.array(MemoryObject).default([]),
  people: z.array(PersonObservation).default([]),
  architecture: z
    .object({
      description: z.string().default(""),
      visibleStructures: z.array(z.string()).default([]),
      possibleStructures: z.array(z.string()).default([]),
    })
    .default({ description: "", visibleStructures: [], possibleStructures: [] }),
  lighting: z
    .object({ description: z.string().default(""), approximateTime: z.string().optional() })
    .default({ description: "" }),
  audio: AudioPlan.default({ globalAmbience: [], positionalSources: [] }),
  worldGenerationPrompt: z.string().default(""),
  uncertainties: z.array(z.string()).default([]),
});
export type MemoryAnalysis = z.infer<typeof MemoryAnalysis>;

/** Pulls the JSON object out of a model reply (tolerates code fences and prose around it). */
export function parseAnalysis(text: string): MemoryAnalysis {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the analysis");
  const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
  const parsed = MemoryAnalysis.safeParse(raw);
  if (!parsed.success) throw new Error(`analysis didn't match the schema: ${parsed.error.message}`);
  return parsed.data;
}
