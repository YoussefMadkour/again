/**
 * Holes for the world's own copies of things we draw ourselves (see Hole in provenance.ts).
 */
import * as THREE from "three";
import type { Hole } from "@/components/world/provenance";
import type { BoundingBox } from "@/lib/analysis/schema";
import type { OriginalCamera } from "@/lib/demo/memory";
import { cameraQuaternion } from "./placement";

/** The copy can sit a few cm off ours: a fraction of the box, and a little of the frame. */
export function growBox([x0, y0, x1, y1]: BoundingBox, fraction = 0.12, margin = 0.008) {
  const gx = (x1 - x0) * fraction + margin;
  const gy = (y1 - y0) * fraction + margin;
  return [
    Math.max(0, x0 - gx),
    Math.max(0, y0 - gy),
    Math.min(1, x1 + gx),
    Math.min(1, y1 + gy),
  ] as const;
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
      color: THREE.Color,
    ) => void,
  ): void;
}

/** How far off the wall's plane the copy may stand (frames stick out; the fit is approximate). */
const WALL_THICKNESS = 0.12;

/**
 * A photo layer on a wall. The wall's colour is the median of the splats on the same plane in
 * a ring around the (grown) box, as the original camera sees them.
 */
export function wallHole(
  splat: SplatSource,
  camera: OriginalCamera,
  aspect: number,
  id: string,
  frame: BoundingBox,
  center: THREE.Vector3,
  normal: THREE.Vector3,
  /** Which of the colours around to take: the median, or higher where the wall is the
   * lightest thing near (behind a person, the ring also catches them and the curtains). */
  quantile = 0.5,
): Hole {
  const box = growBox(frame);
  const ring = growBox(box as unknown as BoundingBox, 0.35, 0.01);
  const toCamera = cameraQuaternion(camera).invert();
  const origin = new THREE.Vector3(...camera.position);
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const world = new THREE.Vector3();
  const c = new THREE.Vector3();
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  splat.updateMatrixWorld(true);
  splat.forEachSplat((_i, at, _s, _q, opacity, color) => {
    if (opacity < 0.5) return;
    world.copy(at).applyMatrix4(splat.matrixWorld);
    if (Math.abs(world.clone().sub(center).dot(normal)) > WALL_THICKNESS) return;
    c.copy(world).sub(origin).applyQuaternion(toCamera);
    const d = -c.z;
    if (d <= 0.05) return;
    const u = (c.x / d / (t * aspect) + 1) / 2;
    const v = (1 - c.y / d / t) / 2;
    const inRing = u >= ring[0] && u <= ring[2] && v >= ring[1] && v <= ring[3];
    const inBox = u >= box[0] && u <= box[2] && v >= box[1] && v <= box[3];
    if (!inRing || inBox) return;
    r.push(color.r);
    g.push(color.g);
    b.push(color.b);
  });
  const median = (v: number[]) => {
    v.sort((x, y) => x - y);
    return v[Math.floor((v.length - 1) * quantile)];
  };
  const wall =
    r.length > 12
      ? new THREE.Color(median(r), median(g), median(b))
      : new THREE.Color(0.8, 0.8, 0.8);
  return { id, kind: "wall", box, center, normal, thickness: WALL_THICKNESS, color: wall };
}

/**
 * A hero mesh of `size` (full extents) standing at `center`, seen at `bbox` in the photo.
 * The erase reaches no further back than just short of the room behind it (a wall, usually,
 * measured around the object's box), since there is nothing behind a wall.
 */
export function objectHole(
  splat: SplatSource,
  camera: OriginalCamera,
  aspect: number,
  id: string,
  bbox: BoundingBox,
  center: THREE.Vector3,
  size: THREE.Vector3,
  /** Furniture keeps the world's copy of its lower half (see HeroObjects). */
  furniture = false,
): Hole {
  const box = growBox(bbox);
  const ring = growBox(box as unknown as BoundingBox, 0.35, 0.01);
  const toCamera = cameraQuaternion(camera).invert();
  const origin = new THREE.Vector3(...camera.position);
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const centerDepth = center.distanceTo(origin);
  const reach = size.z * 0.55 + 0.03;
  const world = new THREE.Vector3();
  const c = new THREE.Vector3();
  const behind: number[] = [];
  splat.updateMatrixWorld(true);
  splat.forEachSplat((_i, at, _s, _q, opacity) => {
    if (opacity < 0.5) return;
    world.copy(at).applyMatrix4(splat.matrixWorld);
    c.copy(world).sub(origin).applyQuaternion(toCamera);
    const d = -c.z;
    if (d <= 0.05) return;
    const u = (c.x / d / (t * aspect) + 1) / 2;
    const v = (1 - c.y / d / t) / 2;
    const inRing = u >= ring[0] && u <= ring[2] && v >= ring[1] && v <= ring[3];
    const inBox = u >= box[0] && u <= box[2] && v >= box[1] && v <= box[3];
    if (!inRing || inBox) return;
    // At the object's own height: not the surface it stands on (a tabletop around a lamp's
    // base would make the room look like it's right behind it).
    if (world.y < center.y - size.y * 0.25) return;
    const range = world.distanceTo(origin) - centerDepth;
    if (range > -reach && range < reach * 3) behind.push(range);
  });
  behind.sort((x, y) => x - y);
  // The room around it (what's beside the object in the photo sits at the wall's depth):
  // the median, relative to the object's centre.
  const room =
    behind.length > 20 ? behind[Math.floor(behind.length * 0.2)] : Number.POSITIVE_INFINITY;
  if (furniture) {
    // Only within our own mesh's outline: the world never built the wall hidden behind its
    // copy, so erasing past our mesh opens onto nothing. (Its offset parts may still show.)
    return {
      id,
      kind: "object",
      box: [...bbox] as unknown as Hole["box"],
      center,
      radius: Math.min(size.x, size.y) * 0.5,
      front: Math.min(reach, size.z * 0.38),
      back: Math.max(0, Math.min(size.z * 0.38, room - 0.04)),
      // The world's legs stay (see HeroObjects).
      floor: center.y,
    };
  }
  return {
    id,
    kind: "object",
    box,
    center,
    radius: Math.max(size.x, size.y) * 0.62,
    front: reach,
    // Can be in front of the centre: placement's ray may have found the wall through the object.
    back: Math.min(reach, room - 0.04),
    // The surface it rests on stays.
    floor: center.y - size.y * 0.5 + 0.015,
  };
}

/**
 * A person's shadow on the wall behind them: the wall is found through their box in the photo
 * (the splats behind `beyond`, the far side of the person), and only what's darker than the
 * wall around it is repainted.
 */
export function shadowHole(
  splat: SplatSource,
  camera: OriginalCamera,
  aspect: number,
  id: string,
  person: BoundingBox,
  beyond: number,
): Hole | null {
  const toCamera = cameraQuaternion(camera).invert();
  const origin = new THREE.Vector3(...camera.position);
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const [x0, y0, x1, y1] = person;
  const world = new THREE.Vector3();
  const c = new THREE.Vector3();
  const pts: THREE.Vector3[] = [];
  splat.updateMatrixWorld(true);
  splat.forEachSplat((_i, at, _s, _q, opacity) => {
    if (opacity < 0.5) return;
    world.copy(at).applyMatrix4(splat.matrixWorld);
    c.copy(world).sub(origin).applyQuaternion(toCamera);
    const d = -c.z;
    if (d < beyond || d > beyond + 1.2) return;
    const u = (c.x / d / (t * aspect) + 1) / 2;
    const v = (1 - c.y / d / t) / 2;
    if (u >= x0 && u <= x1 && v >= y0 && v <= y1) pts.push(world.clone());
  });
  if (pts.length < 50) return null;
  const median = (k: "x" | "y" | "z") =>
    pts.map((p) => p[k]).sort((a, b) => a - b)[pts.length >> 1];
  const center = new THREE.Vector3(median("x"), median("y"), median("z"));
  // Walls stand upright; this one faces back toward the camera.
  const normal = origin.clone().sub(center).setY(0).normalize();
  // A flash shadow falls to one side: wide margins. Down to the hips: lower, it's furniture
  // against the wall (hero objects' boxes are left alone by the repaint too).
  const [bx0, by0, bx1, by1] = growBox(person, 0.3, 0.01);
  const box = [bx0, by0, bx1, by0 + (by1 - by0) * 0.7] as const;
  const hole = wallHole(
    splat,
    camera,
    aspect,
    id,
    box as unknown as BoundingBox,
    center,
    normal,
    0.8,
  );
  return hole.kind === "wall" ? { ...hole, box, thickness: 0.15, shadowOnly: true } : null;
}
