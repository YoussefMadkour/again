# Roadmap

## Faces and fine detail: project the photograph back onto the world

**Problem.** Marble doesn't reconstruct faces. People come out as smooth, blank masks, and
the portraits on the walls melt. It isn't a resolution problem: the full-resolution splat
(now used on desktop) is sharper everywhere but the face is just as blank. There's no facial
detail in the world to recover.

**Idea.** Near the original viewpoint, show the *actual photograph* on the world's surfaces
instead of the splat's guess:

1. World Labs returns a collider mesh (`assets.mesh.collider_mesh_url`, GLB) alongside the splat.
2. Render that mesh with the photo as a **projective texture** from the calibrated original
   camera (`originalCamera`: fov, pitch, yaw are already recovered from the panorama).
3. Blend it over the splat by how close the viewer is to the original camera and how directly
   a surface faces it. Full photo at the viewpoint, fading to splat as you walk away.
   Surfaces the camera never saw get none.
4. Tie the blend to the MEMORY ↔ DREAM control: MEMORY leans on photographic evidence, DREAM
   shows only the model's world.

This makes faces exactly right where the photograph saw them, and honest about where it
didn't, which is the product's core distinction. Optionally, cut people out of the photo as
depth-placed layers for a little parallax (exact from the front, flat from the side).

**Not doing:** AI face restoration or upscaling. It invents a face that isn't the real person's.

## Next milestones

- ~~**Milestone 3:** vision → scene manifest → hero objects + sound.~~ Done and verified live.
- Sounds generated with `STORAGE=local` live under `.data/files` (the 1946 gallery entry's do):
  fine locally, but deployments need fal (or other public) storage.
- A low, soft transition sound for the entry (spec §43).
- ~~**Provenance (P7):** MEMORY ↔ DREAM, hold SPACE, the boundary moment.~~ Done. Next
  refinement: occlusion (things hidden behind something in the photo count as observed today;
  a coarse depth map from the original camera would mark them inferred).
- **Before public launch:** Upstash Redis on Vercel, set `NEXT_PUBLIC_CONTACT_URL`, and a
  delete-my-memory action (World Labs `DELETE /worlds/{id}` + remove from gallery).
