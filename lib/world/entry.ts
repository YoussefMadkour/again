/**
 * Geometry and choreography for the entry transition.
 *
 * The photograph is a plane placed PHOTO_DISTANCE in front of the original camera,
 * sized to exactly fill that camera's vertical field of view. The transition starts
 * with the 3D camera pulled back so the plane lands on the same pixels as the DOM
 * photo card, then flies through the original viewpoint and across the plane.
 */

export const PHOTO_DISTANCE = 1;

/** Plane height that fills the vertical fov at `distance`. */
export function photoPlaneHeight(fovDeg: number, distance = PHOTO_DISTANCE): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
}

export interface CardRect {
  /** Card center relative to viewport center, in px (y positive = down). */
  dx: number;
  dy: number;
  height: number;
  viewportHeight: number;
}

/**
 * Camera offset (in the original camera's local frame) that makes the photo plane
 * appear exactly where the DOM card is. z is how far back to pull the camera.
 */
export function handoffOffset(
  card: CardRect,
  fovDeg: number,
  distance = PHOTO_DISTANCE,
): { x: number; y: number; z: number } {
  const viewDistance = (distance * card.viewportHeight) / card.height;
  const unitsPerPx = (2 * viewDistance * Math.tan((fovDeg * Math.PI) / 360)) / card.viewportHeight;
  return {
    // Moving the camera left makes the plane appear to the right, and so on.
    x: -card.dx * unitsPerPx,
    y: card.dy * unitsPerPx,
    z: viewDistance - distance,
  };
}

/** Timeline in seconds. */
export const ENTRY = {
  duration: 3.8,
  /** Camera reaches the original viewpoint: photo fills the frame. */
  arrive: 2.4,
  /** World fades in around the photo's edges late in the approach, once the camera is
   *  nearly at the viewpoint (earlier, it's still inside the splats behind the room). */
  worldFadeStart: 1.45,
  worldFadeEnd: 2.4,
  /** Photo dissolves into the world as the camera crosses its plane. */
  photoFadeStart: 2.5,
  photoFadeEnd: 3.2,
  /** How far past the original viewpoint the camera drifts (world units). */
  pushThrough: 0.45,
} as const;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

/** Slow start, long gentle landing. */
export const easeInOutQuint = (x: number) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2);

export interface EntryFrame {
  /** 1 = at handoff pose, 0 = at original camera. */
  approach: number;
  /** Forward distance past the original camera. */
  push: number;
  worldOpacity: number;
  photoOpacity: number;
  /** 0 = crisp print edges, 1 = edges fully melted into the world. */
  photoFeather: number;
  done: boolean;
}

export function entryFrame(t: number): EntryFrame {
  const approach = 1 - easeInOutQuint(clamp01(t / ENTRY.arrive));
  const push = ENTRY.pushThrough * smoothstep(ENTRY.arrive - 0.15, ENTRY.duration, t);
  return {
    approach,
    push,
    worldOpacity: smoothstep(ENTRY.worldFadeStart, ENTRY.worldFadeEnd, t),
    photoOpacity: 1 - smoothstep(ENTRY.photoFadeStart, ENTRY.photoFadeEnd, t),
    photoFeather: smoothstep(ENTRY.worldFadeStart, ENTRY.arrive, t),
    done: t >= ENTRY.duration,
  };
}
