import sharp from "sharp";
import { readLocalFile } from "@/lib/ai/providers/local-storage";
import type { BoundingBox } from "@/lib/analysis/schema";

/** Room around the object, so image-to-3D sees its whole silhouette. */
const PAD = 0.12;
const MAX_EDGE = 1024;

export async function fetchImage(url: string): Promise<Buffer> {
  const local = await readLocalFile(url);
  if (local) return local;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`couldn't fetch the photo (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function cropToBox(photoUrl: string, [x0, y0, x1, y1]: BoundingBox) {
  const image = sharp(await fetchImage(photoUrl)).rotate();
  const { width = 0, height = 0 } = await image.metadata();
  const padX = (x1 - x0) * PAD;
  const padY = (y1 - y0) * PAD;
  const left = Math.max(0, Math.floor((x0 - padX) * width));
  const top = Math.max(0, Math.floor((y0 - padY) * height));
  const right = Math.min(width, Math.ceil((x1 + padX) * width));
  const bottom = Math.min(height, Math.ceil((y1 + padY) * height));
  const out = await image
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 92 })
    .toBuffer();
  return new Uint8Array(out);
}
