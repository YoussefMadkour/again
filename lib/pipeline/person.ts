import sharp from "sharp";
import type { PersonModelStatus } from "@/lib/ai/types";
import type { BoundingBox } from "@/lib/analysis/schema";
import { fetchImage } from "./crop";
import { buildHybrid, MAX_FIT_ERROR } from "./hybrid";

type Succeeded = Extract<PersonModelStatus, { state: "succeeded" }>;

/** SAM 3D Body finds everyone; below this overlap, none of them is the layer's person. */
const MIN_IOU = 0.3;

export function iou(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

/** Which detected body is this person, by box overlap (boxes in pixels, photo `w`×`h`). */
export function matchPerson(
  people: Succeeded["people"],
  box: BoundingBox,
  w: number,
  h: number,
): Succeeded["people"][number] | null {
  let best: Succeeded["people"][number] | null = null;
  let bestIou = MIN_IOU;
  for (const p of people) {
    const [x0, y0, x1, y1] = p.bbox;
    const score = iou([x0 / w, y0 / h, x1 / w, y1 / h], box);
    if (score > bestIou) {
      bestIou = score;
      best = p;
    }
  }
  return best;
}

async function download(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`couldn't fetch ${url.split("/").pop()} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * The person as one mesh: their shape fitted onto their posed body, legs from the body.
 * Returns the GLB (in the body model's camera frame) and that camera's vertical field of view.
 */
export async function fitPerson(result: Succeeded, box: BoundingBox, photoUrl: string) {
  const meta = await sharp(await fetchImage(photoUrl)).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const w = (rotated ? meta.height : meta.width) ?? 0;
  const h = (rotated ? meta.width : meta.height) ?? 0;
  const person = matchPerson(result.people, box, w, h);
  if (!person) throw new Error("no body found for this person");
  const [shape, body] = await Promise.all([
    download(result.shapeGlbUrl),
    download(result.bodyGlbUrl),
  ]);
  const node = `person_${String(person.index).padStart(2, "0")}`;
  const { bytes, fit } = await buildHybrid(shape, body, node);
  if (fit.error > MAX_FIT_ERROR) {
    throw new Error(`shape and body disagree (${(fit.error * 100).toFixed(1)} cm)`);
  }
  const fov = (2 * Math.atan(h / 2 / person.focalLength) * 180) / Math.PI;
  return { bytes, fov, fitError: fit.error };
}
