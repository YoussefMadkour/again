/**
 * Which objects become interactive 3D meshes. Deterministic on purpose: code owns the policy.
 * With Jev, a calibrated call on each object decides; without it, the vision model's own
 * scores, weighted. Everything else stays part of the Gaussian world.
 */
import type { ObjectDecision } from "@/lib/ai/types";
import type { MemoryObject } from "./schema";

export const MAX_HERO_OBJECTS = 3;
export const HERO_THRESHOLD = 0.62;
/** Tiny or barely visible objects make poor crops, whatever the model thinks of them. */
const MIN_VISIBILITY = 0.45;
const MIN_BOX_AREA = 0.0025;
/** Hero objects are things you'd pick up. Big furniture stays in the splat: a mesh that size
 * would mean erasing a large region of the world (and whoever stands in front of it). */
const MAX_BOX_AREA = 0.12;
/** The vision model's own "mesh" recommendation is required unless the score is this strong. */
const STRONG_SCORE = 0.8;
/** Jev's call must be at least this concentrated to spend money on a mesh. */
const MIN_DECISION_CONFIDENCE = 0.5;

export function heroScore(o: MemoryObject): number {
  return o.importance * 0.4 + o.interactionPotential * 0.35 + o.meshFeasibility * 0.25;
}

/** Size and evidence rules that hold whoever decides. */
function eligible(o: MemoryObject) {
  if (!o.bbox || o.provenance !== "observed" || o.visibility < MIN_VISIBILITY) return false;
  const [x0, y0, x1, y1] = o.bbox;
  const area = (x1 - x0) * (y1 - y0);
  return area >= MIN_BOX_AREA && area <= MAX_BOX_AREA;
}

export function selectHeroObjects(
  objects: MemoryObject[],
  decisions?: ObjectDecision[],
  max = MAX_HERO_OBJECTS,
): MemoryObject[] {
  if (decisions) {
    // Jev: objects it calls a 3D object (confidently), the ones that matter most first.
    const byId = new Map(decisions.map((d) => [d.id, d]));
    return objects
      .filter(eligible)
      .flatMap((o) => {
        const d = byId.get(o.id);
        return d && d.representation === "object3d" && d.confidence >= MIN_DECISION_CONFIDENCE
          ? [{ o, d }]
          : [];
      })
      .sort((a, b) => b.d.meaning - a.d.meaning)
      .slice(0, max)
      .map(({ o }) => o);
  }
  return objects
    .filter((o) => eligible(o) && o.recommendedRepresentation !== "preserve")
    .map((o) => ({ o, score: heroScore(o) }))
    .filter(
      ({ o, score }) =>
        score >= HERO_THRESHOLD &&
        (o.recommendedRepresentation === "mesh" || score >= STRONG_SCORE),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ o }) => o);
}
