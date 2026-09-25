# Roadmap

## ~~Faces and fine detail~~ Done: photo layers

Marble doesn't reconstruct faces or the pictures on the walls, and no resolution fixes that.
So the photograph's own pixels are laid back into the world (`lib/pipeline/layers.ts`,
`components/world/PhotoLayers.tsx`):

- **Flat things** (framed photos, portraits, posters, text: the vision model marks them
  "preserve") are cut out with a feathered margin and placed on the wall's plane, fitted from
  raycasts. Flat in reality, so correct from any angle. The splat's blurry copy of them is
  repainted as wall, wherever the photo saw it (it sits a few cm off ours; see PROVIDERS.md).
- **People** are cut out with SAM 3 and stand at their depth (measured only through their
  solid pixels), facing the original camera. Full strength near the photo's viewpoint, fading
  as you walk or look away. While shown, the splat's blank-faced copy of them is hidden with
  a photo-space mask in the provenance shader (grown a little, since the model's copy sits a
  few cm off).
- MEMORY ↔ DREAM: flat layers soften toward DREAM; people hand over to the model's figure
  only near DREAM, since half-and-half reads as a ghost.

What's left: a faint trace of the splat figure's outline where the model's copy strays
furthest from the photo; people can't be seen from behind (there's nothing to show).

### ~~People as 3D models wearing their photo~~ Done

Every person layer gets a 3D model: Hunyuan3D's look fitted onto SAM 3D Body's posed body,
wearing the photograph where it saw them (see PROVIDERS.md, "People in 3D"). The second
head is gone: the world's figure is hidden around both its placement and the model's.

What's left: the soft dark shape on the wall behind the 1946 woman at side angles is the
photo's own flash shadow, rebuilt by the world model (correct, if a little blurry). From
well to the side (past ~1.8 m) the model's legs show through the table, since splats can't
occlude meshes. Several people share one hiding capsule (the last one placed).

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
