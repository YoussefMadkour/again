import type { PublicExtras } from "@/lib/pipeline/extras";
import demo1946 from "./1946.json";

/**
 * The demo memory's scene, hero objects and sound: made by the real pipeline (Gemini, SAM 3,
 * TRELLIS, ElevenLabs) and baked locally.
 */
// JSON widens tuples and enums; the baking script wrote exactly this shape.
export const DEMO_EXTRAS = demo1946.extras as unknown as PublicExtras;
