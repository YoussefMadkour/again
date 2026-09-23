/**
 * Per-frame values shared between the camera choreography and the things it drives.
 * Mutated in useFrame, never through React state, so the transition stays at 60fps.
 */
export interface WorldFx {
  worldOpacity: number;
  photoOpacity: number;
  photoFeather: number;
}

export const createWorldFx = (): WorldFx => ({ worldOpacity: 0, photoOpacity: 1, photoFeather: 0 });
