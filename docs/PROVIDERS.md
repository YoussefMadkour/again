# Providers

Every paid service sits behind an interface in `lib/ai/types.ts`, with a mock and a real
implementation chosen by `AI_MODE` in `lib/ai/index.ts`. Provider calls are server-only.

| Interface | Mock | Real | Status |
|---|---|---|---|
| `WorldProvider` | `providers/mock/world.ts`: demo splat after 9s | `providers/real/worldlabs.ts`: World Labs Marble | ✅ Milestone 2 |
| `VisionProvider` | demo manifest | `FalVisionProvider`: Claude Sonnet 5 via fal's OpenRouter router | ✅ M3 |
| `SegmentProvider` | returns the hint | `FalSegmentProvider`: SAM 3, text prompt + nearest box | ✅ M3 |
| `Object3DProvider` | demo `.glb` after 6s | `FalHunyuanProvider`: Hunyuan3D v3 image-to-3D (queued) | ✅ M3 |
| `AudioProvider` | demo `.mp3`s | `ElevenLabsAudioProvider`: sound effects v2, seamless loops | ✅ M3 |
| `FileStorage` | none | `FalStorage` (fal CDN), or `LocalStorage` with `STORAGE=local` | ✅ M3 |

Providers for the extras are built in `lib/ai/extras.ts`. A missing key turns that part off
(its steps become `skipped`). The world never depends on any of it.

## Costs per memory

| | Service | Cost |
|---|---|---|
| World | World Labs `marble-1.1` | 1,580 credits ≈ $1.26 |
| Scene analysis | Claude Sonnet 5 via fal | ≈ $0.03 |
| Object outlines | SAM 3 via fal | $0.005 each |
| Hero objects (≤3) | Hunyuan3D v3 via fal | $0.375 each |
| Sound (1 ambient 15s + ≤2 positional 6s) | ElevenLabs, 40 credits/s | ≤ 1,080 credits |

Visitors on their own World Labs key get the world only, because the extras bill the owner's
fal/ElevenLabs accounts. Set `EXTRAS_FOR_OWN_KEYS=true` to include them.

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

## The extras pipeline (`lib/pipeline/extras.ts`)

```
upload ─┬─► World Labs (world, ~5 min)
        └─► after(): photo → fal CDN → vision (Claude) → scene manifest
                                              ├─► hero objects: score → SAM 3 box → crop → Hunyuan3D (queued)
                                              └─► sounds: 1 ambience + ≤2 positional → ElevenLabs → fal CDN
```

- State lives in the store (`extras:<job>`). `advanceExtras` moves it forward: right after the
  upload (via `after()`), then after each status poll. It holds a lock (`claim`), so concurrent
  polls never pay for the same step twice.
- Hero objects are chosen deterministically (`lib/analysis/hero.ts`):
  `0.4·importance + 0.35·interaction + 0.25·feasibility ≥ 0.62`, observed, visible, at least
  0.25% of the frame, not "preserve" (faces, photos on the wall), at most 3.
- In the browser, objects and positional sounds are placed by raycasting the splat from the
  calibrated original camera through their box in the photo (`lib/world/placement.ts`). The
  splat is erased where a hero mesh stands (Spark `SplatEdit`), so it isn't doubled.
- Clicking a hero object opens its evidence: the original photo, the object outlined,
  "observed here".
- Sound is silent until STEP INSIDE (the click unlocks audio), faint while the photo is still
  up, and full once through it.

**Not yet verified against live fal** (the account was out of balance while this was built):
the vision, SAM 3 and Hunyuan3D calls follow fal's published schemas. The pipeline logic, mock
providers, placement, evidence panel and ElevenLabs are verified. Once fal has balance:
`tsx --env-file=.env.local scripts/extras.ts <gallery_id>`.
