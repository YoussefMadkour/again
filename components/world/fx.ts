/**
 * Per-frame values shared between the camera choreography and the things it drives.
 * Mutated in useFrame, never through React state, so the transition stays at 60fps.
 */
export interface WorldFx {
  worldOpacity: number;
  photoOpacity: number;
  photoFeather: number;
  /**
   * Once the camera reaches the photo's viewpoint, the photo rides with the camera, so it
   * dissolves in place instead of parallaxing against the world as the camera pushes on.
   */
  photoGlued: boolean;
}

export const createWorldFx = (): WorldFx => ({
  worldOpacity: 0,
  photoOpacity: 1,
  photoFeather: 0,
  photoGlued: false,
});
