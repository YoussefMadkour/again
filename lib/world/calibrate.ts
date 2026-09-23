/**
 * Recovers where the photograph sits inside its world.
 *
 * Marble estimates the camera of the uploaded photo (field of view, tilt) but the API doesn't
 * return it. It does return the equirectangular panorama the world was built from, and the
 * photo is embedded in that panorama. So we search for the perspective view of the panorama
 * that best matches the photo. The world's origin is the photo's viewpoint and the pano's
 * centre is the world's -Z, so the best view is the original camera.
 *
 * Pure: works on grayscale pixel arrays, no DOM. The browser side lives in calibrate-image.ts.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** Row-major luminance, any range. */
  data: Float32Array;
}

export interface CameraFit {
  /** Vertical field of view, degrees. */
  fov: number;
  /** Radians. Negative looks down. */
  pitch: number;
  /** Radians. Positive turns left. */
  yaw: number;
  /** Normalized cross-correlation of the best view, -1..1. Above ~0.5 is a real match. */
  score: number;
}

interface Range {
  min: number;
  max: number;
  step: number;
}

const SEARCH = {
  fov: { min: 26, max: 100, step: 4 },
  pitch: { min: -0.4, max: 0.4, step: 0.05 },
  yaw: { min: -0.35, max: 0.35, step: 0.07 },
};

/** Coarse grid, then two finer passes around the best candidate. */
export function fitCamera(photo: GrayImage, pano: GrayImage): CameraFit {
  const evaluator = (img: GrayImage) => {
    const target = normalize(img.data);
    const sampler = createSampler(img.width, img.height, pano);
    return (fov: number, pitch: number, yaw: number): CameraFit => ({
      fov,
      pitch,
      yaw,
      score: correlate(target, sampler(fov, pitch, yaw)),
    });
  };

  // The coarse grid is most of the work, and a quarter of the pixels is plenty to find the basin.
  let best = gridSearch(SEARCH.fov, SEARCH.pitch, SEARCH.yaw, evaluator(halve(photo)));
  const evaluate = evaluator(photo);
  best = evaluate(best.fov, best.pitch, best.yaw);
  for (const shrink of [0.35, 0.12]) {
    const around = (center: number, r: Range): Range => {
      const span = (r.max - r.min) * shrink * 0.5;
      return { min: center - span, max: center + span, step: r.step * shrink };
    };
    best = gridSearch(
      around(best.fov, SEARCH.fov),
      around(best.pitch, SEARCH.pitch),
      around(best.yaw, SEARCH.yaw),
      evaluate,
      best,
    );
  }
  return best;
}

function gridSearch(
  fov: Range,
  pitch: Range,
  yaw: Range,
  evaluate: (f: number, p: number, y: number) => CameraFit,
  seed?: CameraFit,
): CameraFit {
  let best = seed ?? { fov: 0, pitch: 0, yaw: 0, score: Number.NEGATIVE_INFINITY };
  for (let f = fov.min; f <= fov.max + 1e-9; f += fov.step) {
    if (f < 10 || f > 120) continue;
    for (let p = pitch.min; p <= pitch.max + 1e-9; p += pitch.step) {
      for (let y = yaw.min; y <= yaw.max + 1e-9; y += yaw.step) {
        const c = evaluate(f, p, y);
        if (c.score > best.score) best = c;
      }
    }
  }
  return best;
}

/**
 * Returns a function rendering the panorama as a width×height perspective view.
 * Camera looks down -Z, rotated by pitch (about X) then yaw (about Y), like three.js
 * Euler order "YXZ".
 */
export function createSampler(width: number, height: number, pano: GrayImage) {
  const out = new Float32Array(width * height);
  const aspect = width / height;
  return (fovDeg: number, pitch: number, yaw: number): Float32Array => {
    const t = Math.tan((fovDeg * Math.PI) / 360);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    let i = 0;
    for (let row = 0; row < height; row++) {
      const vy = (1 - ((row + 0.5) / height) * 2) * t;
      for (let col = 0; col < width; col++) {
        const vx = (((col + 0.5) / width) * 2 - 1) * t * aspect;
        // pitch: rotate (vy, -1) about X
        const y1 = vy * cp + sp;
        const z1 = vy * sp - cp;
        // yaw: rotate (vx, z1) about Y
        const x2 = vx * cy + z1 * sy;
        const z2 = -vx * sy + z1 * cy;
        const lon = Math.atan2(x2, -z2);
        const lat = Math.atan2(y1, Math.hypot(x2, z2));
        let u = Math.floor((lon / (2 * Math.PI) + 0.5) * pano.width) % pano.width;
        if (u < 0) u += pano.width;
        const v = Math.min(
          pano.height - 1,
          Math.max(0, Math.floor((0.5 - lat / Math.PI) * pano.height)),
        );
        out[i++] = pano.data[v * pano.width + u];
      }
    }
    return out;
  };
}

function halve(img: GrayImage): GrayImage {
  const width = Math.floor(img.width / 2);
  const height = Math.floor(img.height / 2);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * 2 * img.width + x * 2;
      data[y * width + x] =
        (img.data[i] + img.data[i + 1] + img.data[i + img.width] + img.data[i + img.width + 1]) / 4;
    }
  }
  return { width, height, data };
}

function normalize(data: Float32Array): Float32Array {
  let mean = 0;
  for (const v of data) mean += v;
  mean /= data.length;
  let variance = 0;
  for (const v of data) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / data.length) || 1;
  return data.map((v) => (v - mean) / std);
}

/** NCC against an already-normalized target. */
function correlate(target: Float32Array, candidate: Float32Array): number {
  const n = target.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += candidate[i];
  mean /= n;
  let dot = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const c = candidate[i] - mean;
    dot += c * target[i];
    variance += c * c;
  }
  if (variance === 0) return 0;
  return dot / (Math.sqrt(variance / n) * n);
}
