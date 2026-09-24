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

/** Where the ray through photo point (u, v) first hits the splat, or null. */
export function hitPoint(
  target: THREE.Object3D,
  camera: OriginalCamera,
  aspect: number,
  u: number,
  v: number,
): THREE.Vector3 | null {
  const raycaster = new THREE.Raycaster();
  raycaster.ray.copy(rayThroughPhoto(camera, aspect, u, v));
  return raycaster.intersectObject(target, false)[0]?.point ?? null;
}

export interface LayerQuad {
  /** Corners in world space: top-left, top-right, bottom-right, bottom-left. */
  corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  center: THREE.Vector3;
  /** Faces the original camera. */
  normal: THREE.Vector3;
}

/**
 * The photo box as a quad in the world, so it lands exactly on the photo from the original
 * camera: rays through the box's corners meet a plane.
 *
 *   "wall"    the plane is fitted to where the box's rays hit the splat (a portrait on a wall)
 *   "facing"  the plane faces the original camera at the box's depth (a person)
 */
export function layerQuad(
  target: THREE.Object3D,
  camera: OriginalCamera,
  aspect: number,
  [x0, y0, x1, y1]: BoundingBox,
  mode: "wall" | "facing",
  /**
   * Points (0..1 within the box) where the layer is solid. A person's box is mostly wall
   * around them; rays through the gaps would put the layer on the wall behind.
   */
  solid?: [number, number][],
): LayerQuad | null {
  const at = (u: number, v: number) => hitPoint(target, camera, aspect, u, v);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = x1 - x0;
  const h = y1 - y0;
  const origin = new THREE.Vector3(...camera.position);

  // Depth from where the thing actually is: its solid pixels, or a grid over the box's middle.
  const grid: [number, number][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) grid.push([0.2 + i * 0.2, 0.2 + j * 0.2]);
  const samples = (solid && solid.length >= 4 ? solid : grid)
    .map(([su, sv]) => at(x0 + su * w, y0 + sv * h))
    .filter((p): p is THREE.Vector3 => p !== null);
  if (samples.length < 3) return null;
  const depths = samples.map((p) => p.distanceTo(origin)).sort((a, b) => a - b);
  // Things stand in front of what's behind them: favour the nearer hits (people), the median
  // for flat things (a frame's glass can let a ray through to the wall).
  const depth = depths[Math.floor((depths.length - 1) * (mode === "facing" ? 0.3 : 0.5))];
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion(camera));
  const centerRay = rayThroughPhoto(camera, aspect, cx, cy);
  const center = centerRay.at(depth, new THREE.Vector3());

  let normal = forward.clone().negate();
  if (mode === "wall") {
    const l = at(x0 + w * 0.2, cy);
    const r = at(x1 - w * 0.2, cy);
    const t = at(cx, y0 + h * 0.2);
    const b = at(cx, y1 - h * 0.2);
    if (l && r && t && b) {
      const fitted = new THREE.Vector3()
        .crossVectors(r.clone().sub(l), t.clone().sub(b))
        .normalize();
      if (fitted.dot(centerRay.direction) > 0) fitted.negate();
      // Trust the fit only when it's a plausible wall (not edge-on to the camera).
      if (-fitted.dot(centerRay.direction) > 0.25) normal = fitted;
    }
  }

  // A hair in front of what it lands on, so the splat doesn't poke through.
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    normal,
    center.clone().addScaledVector(centerRay.direction, -depth * 0.012),
  );
  const corner = (u: number, v: number) =>
    rayThroughPhoto(camera, aspect, u, v).intersectPlane(plane, new THREE.Vector3());
  const corners = [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)];
  if (corners.some((c) => c === null)) return null;
  return {
    corners: corners as LayerQuad["corners"],
    center: plane.projectPoint(center, new THREE.Vector3()),
    normal,
  };
}
