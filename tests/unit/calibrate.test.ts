import { describe, expect, it } from "vitest";
import { createSampler, fitCamera, type GrayImage } from "@/lib/world/calibrate";

/** A smooth, non-repeating fake room: a few low-frequency blobs wrapped around the sphere. */
function syntheticPano(width = 512, height = 256): GrayImage {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * Math.PI * 2;
      const lat = (y / height) * Math.PI;
      data[y * width + x] =
        Math.sin(lon * 3 + 1.3) * Math.cos(lat * 2) +
        0.6 * Math.sin(lon * 7 - lat * 5) +
        0.4 * Math.cos(lon * 13 + lat * 9);
    }
  }
  return { width, height, data };
}

describe("camera calibration from the panorama", () => {
  it("recovers the field of view, tilt and heading of a photo taken from the pano", () => {
    const pano = syntheticPano();
    const truth = { fov: 47, pitch: -0.09, yaw: 0.12 };
    const width = 72;
    const height = 54;
    const photo = {
      width,
      height,
      data: createSampler(width, height, pano)(truth.fov, truth.pitch, truth.yaw).slice(),
    };

    const fit = fitCamera(photo, pano);
    expect(fit.score).toBeGreaterThan(0.95);
    expect(fit.fov).toBeCloseTo(truth.fov, -0.5); // within ~2°
    expect(Math.abs(fit.pitch - truth.pitch)).toBeLessThan(0.03);
    expect(Math.abs(fit.yaw - truth.yaw)).toBeLessThan(0.03);
  });

  it("reports a low score when the photo isn't in the panorama", () => {
    const pano = syntheticPano();
    const noise = new Float32Array(72 * 54).map((_, i) => (Math.sin(i * 12.9898) * 43758.5453) % 1);
    expect(fitCamera({ width: 72, height: 54, data: noise }, pano).score).toBeLessThan(0.3);
  });
});
