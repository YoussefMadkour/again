# Providers

Every paid service sits behind an interface in `lib/ai/types.ts`, with a mock and a real
implementation chosen by `AI_MODE` in `lib/ai/index.ts`. Provider calls are server-only.

| Interface | Mock | Real | Status |
|---|---|---|---|
| `WorldProvider` | `providers/mock/world.ts`: demo splat after 9s | `providers/real/worldlabs.ts`: World Labs Marble | ✅ Milestone 2 |
| Vision | | | Milestone 3 |
| Object 3D (FAL Hunyuan3D) | | | Milestone 3 |
| Audio (ElevenLabs) | | | Milestone 3 |

## World Labs, as actually observed

- Flow: `POST /media-assets:prepare_upload` → `PUT` the photo to the signed URL →
  `POST /worlds:generate` (`is_pano: false`) → poll `GET /operations/{id}`.
- `prepare_upload` returns `media_asset.media_asset_id` (the docs say `id`).
- Operation snapshots use `world_id` and **omit the panorama**; `GET /worlds/{id}` has it.
- Splat, panorama and thumbnail URLs are on `cdn.marble.worldlabs.ai`. They're public, but the
  URLs are unguessable, and they send `Access-Control-Allow-Origin: *`, so Spark loads them directly.
- Splats come as `100k`, `500k` and `full_res` (~1.2 / 7 / 28 MB for a room). Touch devices get
  100k. Desktops enter on 500k and cross-fade to `full_res` once it has loaded in the background,
  so the memory is ready as fast as before.
- The world's origin is the photo's viewpoint, looking down −Z (after the usual 180° X flip).
  The photo's field of view and tilt are **not** returned. See the calibration below.

## Camera calibration

`lib/world/calibrate.ts` recovers the original camera by searching for the perspective view of
Marble's panorama that best matches the photo (normalized cross-correlation on 96px grayscale,
coarse-to-fine over fov × pitch × yaw). It runs in the browser once the world is ready, in well
under a second.

On the 1946 test photo, the panorama fit gave fov 45.05°, pitch −0.056, yaw 0 (score 0.85),
agreeing with a brute-force search that rendered the splat itself (44°, −0.06). Below a 0.45
score it falls back to fov 50°, level.
