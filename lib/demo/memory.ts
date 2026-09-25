import type { Vector3Tuple } from "three";
import demo1946 from "./1946.json";

export interface OriginalCamera {
  position: Vector3Tuple;
  /** [pitch, yaw, roll] in radians, applied in three.js Euler order "YXZ". */
  rotation: Vector3Tuple;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface Memory {
  id: string;
  /** The gallery memory it was baked from, when it was (so it isn't listed twice). */
  galleryId?: string;
  /** How it's introduced on the home screen. */
  title?: string;
  caption?: string;
  photoUrl: string;
  /** width / height of the photograph. */
  photoAspect: number;
  splatUrl: string;
  /** A sharper splat of the same world, faded in once it has loaded. */
  splatUpgradeUrl?: string;
  /** Orientation fix applied to the splat (Marble exports are Y-down). */
  splatQuaternion: [number, number, number, number];
  /** Uniform scale about the origin (the photo's viewpoint), e.g. Marble's metric scale. */
  splatScale: number;
  originalCamera: OriginalCamera;
}

/** Marble worlds are OpenCV-convention; its viewer rotates 180° about X. */
export const MARBLE_SPLAT_QUATERNION: Memory["splatQuaternion"] = [1, 0, 0, 0];

/**
 * The mock world: a painted bedroom from Spark's examples. Mock mode "generates" it for any
 * photo. Its photograph is a render of the splat from `originalCamera` (see
 * scripts/capture-demo-photo.ts), so photo and world line up exactly at the crossing.
 */
export const PAINTED_MEMORY: Memory = {
  id: "painted-bedroom",
  photoUrl: "/demo/photo.jpg",
  photoAspect: 4 / 3,
  splatUrl: "/demo/painted-bedroom.spz",
  splatQuaternion: [1, 0, 0, 0],
  splatScale: 1,
  originalCamera: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    fov: 60,
  },
};

/**
 * The demo memory: a real 1946 photograph (Russell Lee, NARA 540360, public domain) and the
 * world World Labs made from it, baked into public/demo/1946 by scripts/bake-demo.ts.
 */
export const DEMO_MEMORY: Memory = {
  id: "demo-1946",
  galleryId: demo1946.galleryId,
  title: "A living room, 1946",
  caption:
    "A miner's wife in a Colorado coal camp holds a portrait of a man in uniform. Photographed by Russell Lee.",
  photoUrl: demo1946.photoUrl,
  photoAspect: 1815 / 1393,
  splatUrl: demo1946.splatUrl,
  // Sharper, from World Labs' CDN, when online.
  splatUpgradeUrl: demo1946.splatUpgradeUrl ?? undefined,
  splatQuaternion: MARBLE_SPLAT_QUATERNION,
  splatScale: demo1946.splatScale,
  originalCamera: demo1946.originalCamera as OriginalCamera,
};
