/**
 * Photo layers: the photograph's own pixels for the things a world model can't rebuild.
 *
 *   flat     framed photographs, portraits, posters, text: flat in reality, so the photo's
 *            pixels on a plane at the wall's depth are right from any angle
 *   person   a cutout at the person's depth; exact from near where the photo was taken
 *
 * Returns a transparent PNG and the exact region of the photo it covers (the box plus padding):
 * the layer must be drawn to that region, or it comes out shrunk against the world.
 */
import sharp, { type Sharp } from "sharp";
import type { FalClient } from "@/lib/ai/providers/real/fal";
import type { BoundingBox } from "@/lib/analysis/schema";
import { fetchImage } from "./crop";

const MAX_EDGE = 1024;

interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

function region(width: number, height: number, [x0, y0, x1, y1]: BoundingBox, pad: number): Region {
  const px = (x1 - x0) * pad;
  const py = (y1 - y0) * pad;
  const left = Math.max(0, Math.floor((x0 - px) * width));
  const top = Math.max(0, Math.floor((y0 - py) * height));
  const right = Math.min(width, Math.ceil((x1 + px) * width));
  const bottom = Math.min(height, Math.ceil((y1 + py) * height));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export interface Cutout {
  bytes: Uint8Array<ArrayBuffer>;
  /** Normalized region of the photo the image covers. */
  box: BoundingBox;
}

const normalized = (r: Region, width: number, height: number): BoundingBox => [
  r.left / width,
  r.top / height,
  (r.left + r.width) / width,
  (r.top + r.height) / height,
];

/** The box of the photo with softly feathered edges, so it sits into the wall. */
export async function cutoutFlat(photoUrl: string, bbox: BoundingBox): Promise<Cutout> {
  const photo = sharp(await fetchImage(photoUrl)).rotate();
  const { width = 0, height = 0 } = await photo.metadata();
  // A wide margin of the photo's own wall, feathered: the splat's copy of a frame sits a few
  // centimetres off, and this covers its rim with matching wall.
  const r = region(width, height, bbox, 0.16);
  const feather = Math.max(2, Math.round(Math.min(r.width, r.height) * 0.14));
  const alpha = Buffer.alloc(r.width * r.height);
  for (let y = 0; y < r.height; y++) {
    const fy = Math.min(1, Math.min(y, r.height - 1 - y) / feather);
    for (let x = 0; x < r.width; x++) {
      const fx = Math.min(1, Math.min(x, r.width - 1 - x) / feather);
      alpha[y * r.width + x] = Math.round(255 * Math.min(fx, fy));
    }
  }
  return { bytes: await withAlpha(photo, r, alpha), box: normalized(r, width, height) };
}

/**
 * The person, cut out with SAM 3. SAM finds every "person" (including the ones inside framed
 * photos), so we keep the mask whose box best matches the vision model's.
 */
export async function cutoutPerson(
  fal: FalClient,
  photoUrl: string,
  bbox: BoundingBox,
): Promise<Cutout> {
  const out = await fal.run<{
    masks?: { url: string }[] | null;
    metadata?: { index: number; box: number[] }[] | null;
  }>("fal-ai/sam-3/image", {
    image_url: photoUrl,
    prompt: "person",
    apply_mask: false,
    include_boxes: true,
    return_multiple_masks: true,
    max_masks: 5,
    output_format: "png",
  });
  const masks = out.masks ?? [];
  const boxes = (out.metadata ?? []).map((m) => m.box);
  let best = -1;
  let bestIou = 0.2;
  boxes.forEach(([cx, cy, w, h], i) => {
    const score = iou([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], bbox);
    if (score > bestIou) {
      bestIou = score;
      best = i;
    }
  });
  if (best < 0 || !masks[best]) throw new Error("couldn't find the person in the photo");

  const photoBytes = await fetchImage(photoUrl);
  const photo = sharp(photoBytes).rotate();
  const { width = 0, height = 0 } = await photo.metadata();
  const r = region(width, height, bbox, 0.06);
  const maskBytes = Buffer.from(await (await fetch(masks[best].url)).arrayBuffer());
  const alpha = await sharp(maskBytes)
    .resize(width, height, { fit: "fill" })
    .extract(r)
    .toColourspace("b-w")
    .blur(1.2)
    .raw()
    .toBuffer();
  return { bytes: await withAlpha(photo, r, alpha), box: normalized(r, width, height) };
}

/**
 * Crop to `r` and use `alpha` as transparency. Two passes on purpose: sharp orders operations
 * itself, and a removeAlpha() in the same pipeline runs after joinChannel(), dropping it.
 */
async function withAlpha(photo: Sharp, r: Region, alpha: Buffer) {
  const rgb = await photo.extract(r).removeAlpha().toColourspace("srgb").raw().toBuffer();
  return finish(
    sharp(rgb, { raw: { width: r.width, height: r.height, channels: 3 } }).joinChannel(alpha, {
      raw: { width: r.width, height: r.height, channels: 1 },
    }),
  );
}

async function finish(image: Sharp) {
  const out = await image
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return new Uint8Array(out);
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}
