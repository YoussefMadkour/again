import type { Vector3Tuple } from "three";

export interface OriginalCamera {
  position: Vector3Tuple;
  /** Euler XYZ, radians. */
  rotation: Vector3Tuple;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface Memory {
  id: string;
  photoUrl: string;
  /** width / height of the photograph. */
  photoAspect: number;
  splatUrl: string;
  /** Orientation fix applied to the splat (Marble exports are Y-down). */
  splatQuaternion: [number, number, number, number];
  originalCamera: OriginalCamera;
}

/**
 * The demo memory. The photograph is a render of the splat from `originalCamera`
 * (see scripts/capture-demo-photo.ts), so the photo and the world line up exactly
 * at the moment the camera crosses the image plane.
 */
export const DEMO_MEMORY: Memory = {
  id: "demo-painted-bedroom",
  photoUrl: "/demo/photo.jpg",
  photoAspect: 4 / 3,
  splatUrl: "/demo/painted-bedroom.spz",
  splatQuaternion: [1, 0, 0, 0],
  originalCamera: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    fov: 60,
  },
};
