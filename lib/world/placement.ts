/**
 * Finds where something in the photograph is in the 3D world: rays from the original camera
 * through its box in the photo, hitting the splat. Used to place hero objects and sounds.
 */
import * as THREE from "three";
import type { BoundingBox } from "@/lib/analysis/schema";
import type { OriginalCamera } from "@/lib/demo/memory";

export interface Placement {
  /** Centre of the object in world space. */
  center: THREE.Vector3;
  /** World-space size of the box at the hit depth. */
  width: number;
  height: number;
  /** Distance from the original camera. */
  distance: number;
}

/** Ray from the original camera through photo coordinates (u, v), 0..1 from top-left. */
export function rayThroughPhoto(
  camera: OriginalCamera,
  aspect: number,
  u: number,
  v: number,
): THREE.Ray {
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const dir = new THREE.Vector3((u * 2 - 1) * t * aspect, (1 - v * 2) * t, -1)
    .normalize()
    .applyQuaternion(cameraQuaternion(camera));
  return new THREE.Ray(new THREE.Vector3(...camera.position), dir);
}

export function cameraQuaternion(camera: OriginalCamera) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...camera.rotation, "YXZ"));
}

const SAMPLES = 5;
/** Objects stand in front of what's behind them, so favour the nearer hits. */
const DEPTH_PERCENTILE = 0.3;

/**
 * Samples a grid inside the box's middle and takes a near-ish depth. Null when nothing is hit
 * (the object is outside the reconstructed world).
 */
export function placeBox(
  target: THREE.Object3D,
  camera: OriginalCamera,
  aspect: number,
  [x0, y0, x1, y1]: BoundingBox,
): Placement | null {
  const raycaster = new THREE.Raycaster();
  const distances: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    for (let j = 0; j < SAMPLES; j++) {
      // Inner 60% of the box: its edges are often background.
      const u = x0 + (x1 - x0) * (0.2 + (0.6 * i) / (SAMPLES - 1));
      const v = y0 + (y1 - y0) * (0.2 + (0.6 * j) / (SAMPLES - 1));
      raycaster.ray.copy(rayThroughPhoto(camera, aspect, u, v));
      const hit = raycaster.intersectObject(target, false)[0];
      if (hit) distances.push(hit.distance);
    }
  }
  if (distances.length < 3) return null;
  distances.sort((a, b) => a - b);
  const distance = distances[Math.floor((distances.length - 1) * DEPTH_PERCENTILE)];
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const width = distance * (x1 - x0) * 2 * t * aspect;
  const height = distance * (y1 - y0) * 2 * t;
  const ray = rayThroughPhoto(camera, aspect, (x0 + x1) / 2, (y0 + y1) / 2);
  // The rays hit the front of the object; its middle is roughly half a width further in.
  const center = ray.at(distance + Math.min(width, height) / 2, new THREE.Vector3());
  return { center, width, height, distance };
}
