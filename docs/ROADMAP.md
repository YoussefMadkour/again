# Roadmap

## ~~Faces and fine detail~~ Done: photo layers

Marble doesn't reconstruct faces or the pictures on the walls, and no resolution fixes that.
So the photograph's own pixels are laid back into the world (`lib/pipeline/layers.ts`,
`components/world/PhotoLayers.tsx`):

- **Flat things** (framed photos, portraits, posters, text: the vision model marks them
  "preserve") are cut out with a feathered margin and placed on the wall's plane, fitted from
  raycasts. Flat in reality, so correct from any angle. The splat's blurry copy under them is
  erased with a thin slab.
- **People** are cut out with SAM 3 and stand at their depth (measured only through their
  solid pixels), facing the original camera. Full strength near the photo's viewpoint, fading
  as you walk or look away. While shown, the splat's blank-faced copy of them is hidden with
  a photo-space mask in the provenance shader (grown a little, since the model's copy sits a
  few cm off).
- MEMORY ↔ DREAM: flat layers soften toward DREAM; people hand over to the model's figure
  only near DREAM, since half-and-half reads as a ghost.

What's left: a faint trace of the splat figure's outline where the model's copy strays
furthest from the photo; people can't be seen from behind (there's nothing to show).

### Prototype: people as 3D bodies wearing their photo (`?body=1`)

`fal-ai/sam-3/3d-body` ($0.02, ~16s) returns a posed body mesh per person, in its own camera
frame. Its camera agreed with our calibration (44.1° vs 45.05°; 3.6m vs our 4.0m). The mesh
is aligned by re-projecting its field of view into ours, scaling about the camera to the
splat's depth, and rotating by our camera; the person's cutout is then projected onto it
from the original camera, fading on surfaces that faced away (`components/world/BodyLayer.tsx`).

Result on the 1946 room: from ~30° off, she is still photographic (face, hair, apron wrap
the body) where the flat cutout has already handed back to the model's blank figure. But
the model's figure is hidden around World Labs' placement of her, not SAM's, so a second
head shows behind her at that angle. To ship it: fit the hiding capsule to the body mesh
(it's the better estimate of where she is), move the splat hiding to follow the body, and
call SAM 3D Body in the pipeline per person layer (with the person's mask as `mask_url`).
The demo has the body attached; new memories don't call it yet.

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
