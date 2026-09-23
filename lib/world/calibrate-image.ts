"use client";

import { type CameraFit, fitCamera, type GrayImage } from "./calibrate";

/** Small enough to search in well under a second, big enough to lock on to a room. */
const PHOTO_WIDTH = 96;
const PANO_WIDTH = 1024;

export async function calibrateFromPano(photoUrl: string, panoUrl: string): Promise<CameraFit> {
  const [photo, pano] = await Promise.all([loadImage(photoUrl), loadImage(panoUrl)]);
  const photoHeight = Math.round((PHOTO_WIDTH * photo.naturalHeight) / photo.naturalWidth);
  return fitCamera(
    toGray(photo, PHOTO_WIDTH, photoHeight),
    toGray(pano, PANO_WIDTH, PANO_WIDTH / 2),
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url.slice(0, 60)}`));
    img.src = url;
  });
}

/** Downscale by repeated halving (plain drawImage aliases badly at big ratios), then to luma. */
function toGray(img: HTMLImageElement, width: number, height: number): GrayImage {
  let source: CanvasImageSource = img;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  while (w / 2 > width && h / 2 > height) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    source = drawTo(source, w, h);
  }
  const ctx = drawTo(source, width, height).getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return { width, height, data };
}

function drawTo(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}
