"use client";

import type { GenerationStatus, WorldResult } from "@/lib/ai/types";
import { MARBLE_SPLAT_QUATERNION, type Memory } from "@/lib/demo/memory";
import { photoProblem } from "@/lib/upload";
import { calibrateFromPano } from "@/lib/world/calibrate-image";

/** Long edge of the photo we send and keep. Plenty for Marble, and re-encoding strips EXIF (GPS). */
const MAX_EDGE = 2048;
const POLL_MS = 4000;
/** Below this, the photo wasn't found in the pano and we fall back to a typical camera. */
const MIN_CALIBRATION_SCORE = 0.45;
const FALLBACK_CAMERA = { fov: 50, pitch: 0, yaw: 0 };

export interface PreparedPhoto {
  blob: Blob;
  /** Object URL (or data URL after a reload). */
  url: string;
  aspect: number;
}

export class MemoryError extends Error {}

/** Validates, applies EXIF orientation, downsizes and re-encodes the photo. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const problem = photoProblem(file);
  if (problem) throw new MemoryError(problem);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new MemoryError("this photo couldn't be read");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new MemoryError("this photo couldn't be read");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new MemoryError("this photo couldn't be read");
  return { blob, url: URL.createObjectURL(blob), aspect: width / height };
}

export async function submitPhoto(photo: Blob): Promise<string> {
  const body = new FormData();
  body.append("photo", new File([photo], "memory.jpg", { type: "image/jpeg" }));
  const res = await fetch("/api/world", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
  if (!res.ok || !json.jobId)
    throw new MemoryError(json.error ?? "this memory couldn't be started");
  return json.jobId;
}

/** Resolves when the world exists. Network hiccups are retried; only a real failure rejects. */
export async function waitForWorld(jobId: string, signal: AbortSignal): Promise<WorldResult> {
  for (;;) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const res = await fetch(`/api/world/${encodeURIComponent(jobId)}`, {
        signal,
        cache: "no-store",
      });
      if (res.status === 404) throw new MemoryError("this memory has expired");
      const status = (await res.json()) as GenerationStatus;
      if (status.state === "succeeded") return status.result;
      if (status.state === "failed") throw new MemoryError("this memory couldn't be reconstructed");
    } catch (error) {
      if (error instanceof MemoryError || (error as Error).name === "AbortError") throw error;
    }
    await sleep(POLL_MS, signal);
  }
}

/** Turns a generated world plus the user's photo into something the viewer can enter. */
export async function buildMemory(
  jobId: string,
  photo: PreparedPhoto,
  world: WorldResult,
): Promise<Memory> {
  let camera = FALLBACK_CAMERA;
  if (world.panoUrl) {
    try {
      const fit = await calibrateFromPano(photo.url, world.panoUrl);
      if (fit.score >= MIN_CALIBRATION_SCORE) camera = fit;
      console.info("[again] camera", { ...fit, used: camera === fit });
    } catch (error) {
      console.warn("[again] calibration failed, using a typical camera", error);
    }
  }
  const lowRes = world.splatUrlLowRes && window.matchMedia("(pointer: coarse)").matches;
  return {
    id: jobId,
    photoUrl: photo.url,
    photoAspect: photo.aspect,
    splatUrl: lowRes ? (world.splatUrlLowRes as string) : world.splatUrl,
    splatQuaternion: MARBLE_SPLAT_QUATERNION,
    // Scaling about the origin keeps the photo's viewpoint where it is.
    splatScale: world.metricScale,
    originalCamera: {
      position: [0, 0, 0],
      rotation: [camera.pitch, camera.yaw, 0],
      fov: camera.fov,
    },
  };
}

/**
 * A generation takes minutes and costs money, so an in-flight memory survives a reload.
 * Per-tab convenience only: failures are ignored.
 */
const SESSION_KEY = "again:pending-memory";

interface PendingMemory {
  jobId: string;
  photoDataUrl: string;
  aspect: number;
}

export async function rememberPending(jobId: string, photo: PreparedPhoto) {
  try {
    const photoDataUrl = await blobToDataUrl(photo.blob);
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ jobId, photoDataUrl, aspect: photo.aspect }),
    );
  } catch {
    // Storage full or blocked: the memory just won't survive a reload.
  }
}

export function recallPending(): { jobId: string; photo: PreparedPhoto } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingMemory;
    if (!p.jobId || !p.photoDataUrl) return null;
    return {
      jobId: p.jobId,
      photo: { blob: dataUrlToBlob(p.photoDataUrl), url: p.photoDataUrl, aspect: p.aspect },
    };
  } catch {
    return null;
  }
}

export function forgetPending() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
