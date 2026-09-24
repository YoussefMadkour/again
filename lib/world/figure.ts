/**
 * Finds the world model's own copy of a person, in 3D.
 *
 * Marble rebuilds people as blank-faced figures a few centimetres off from where the photo
 * shows them. Hiding splats inside the photo's silhouette (in 2D) misses the offset parts,
 * and growing the silhouette far enough to catch them eats the wall behind the person. So:
 * take the splats inside the silhouette at the person's depth (the figure's core), fit an
 * upright capsule around them, and hide within that volume. The wall behind stays.
 */
import * as THREE from "three";
import type { OriginalCamera } from "@/lib/demo/memory";
import { cameraQuaternion } from "./placement";

export interface FigureCapsule {
  /** Axis position on the ground plane (world x, z). */
  x: number;
  z: number;
  radius: number;
  yMin: number;
  yMax: number;
}

interface SplatSource {
  matrixWorld: THREE.Matrix4;
  updateMatrixWorld(force?: boolean): void;
  forEachSplat(
    cb: (
      i: number,
      center: THREE.Vector3,
      s: THREE.Vector3,
      q: THREE.Quaternion,
      opacity: number,
    ) => void,
  ): void;
}

/** Alpha of the person's (undilated) silhouette at photo coordinates, 0..1. */
export type Silhouette = (u: number, v: number) => number;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];

export function fitFigureCapsule(
  splat: SplatSource,
  camera: OriginalCamera,
  aspect: number,
  silhouette: Silhouette,
  /** The person's depth along the original camera's view, in metres. */
  depth: number,
): FigureCapsule | null {
  splat.updateMatrixWorld(true);
  const toCamera = cameraQuaternion(camera).invert();
  const origin = new THREE.Vector3(...camera.position);
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const world = new THREE.Vector3();
  const c = new THREE.Vector3();
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];

  splat.forEachSplat((_i, center, _s, _q, opacity) => {
    if (opacity < 0.25) return;
    world.copy(center).applyMatrix4(splat.matrixWorld);
    c.copy(world).sub(origin).applyQuaternion(toCamera);
    const d = -c.z;
    if (d <= 0.05 || Math.abs(d - depth) > 0.55) return;
    const u = (c.x / d / (t * aspect) + 1) / 2;
    const v = (1 - c.y / d / t) / 2;
    if (u < 0 || u > 1 || v < 0 || v > 1 || silhouette(u, v) < 0.5) return;
    xs.push(world.x);
    ys.push(world.y);
    zs.push(world.z);
  });
  if (xs.length < 60) return null;

  const sx = [...xs].sort((a, b) => a - b);
  const sz = [...zs].sort((a, b) => a - b);
  const sy = [...ys].sort((a, b) => a - b);
  const x = percentile(sx, 0.5);
  const z = percentile(sz, 0.5);
  const radial = xs.map((xi, i) => Math.hypot(xi - x, zs[i] - z)).sort((a, b) => a - b);
  return {
    x,
    z,
    // Wide enough for the figure's offset copy, not the wall behind it.
    radius: percentile(radial, 0.92) + 0.1,
    yMin: percentile(sy, 0.02) - 0.05,
    yMax: percentile(sy, 0.99) + 0.12,
  };
}
