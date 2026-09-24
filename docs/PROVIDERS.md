# Providers

Every paid service sits behind an interface in `lib/ai/types.ts`, with a mock and a real
implementation chosen by `AI_MODE` in `lib/ai/index.ts`. Provider calls are server-only.

| Interface | Mock | Real | Status |
|---|---|---|---|
| `WorldProvider` | `providers/mock/world.ts`: demo splat after 9s | `providers/real/worldlabs.ts`: World Labs Marble | ✅ Milestone 2 |
| `VisionProvider` | demo manifest | `GeminiVisionProvider` (Google AI Studio, photo inline, native box format); `FalVisionProvider` (Gemini via fal/OpenRouter) as fallback | ✅ M3 |
| `SegmentProvider` | returns the hint | `FalSegmentProvider`: SAM 3, text prompt + nearest box | ✅ M3 |
| `Object3DProvider` | demo `.glb` after 6s | `FalMeshProvider`: SAM 3 cutout → TRELLIS (default), TRELLIS 2 or Hunyuan3D v3 (`MESH_MODEL`) | ✅ M3 |
| `AudioProvider` | demo `.mp3`s | `ElevenLabsAudioProvider`: sound effects v2, seamless loops | ✅ M3 |
| `FileStorage` | none | `FalStorage` (fal CDN), or `LocalStorage` with `STORAGE=local` | ✅ M3 |

Providers for the extras are built in `lib/ai/extras.ts`. A missing key turns that part off
(its steps become `skipped`). The world never depends on any of it.

## Costs per memory

| | Service | Cost |
|---|---|---|
| World | World Labs `marble-1.1` | 1,580 credits ≈ $1.26 |
| Scene analysis | Gemini Flash (Google AI Studio) | < $0.01 |
| Object outlines | SAM 3 via fal | $0.005 each |
| Hero objects (≤3) | SAM 3 cutout + TRELLIS via fal | ≈ $0.025 each |
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
        └─► after(): photo → fal CDN → vision (Gemini) → scene manifest
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

Verified live end to end on the 1946 photo: Gemini analysis → SAM 3 box → crop → fal CDN →
SAM 3 cutout → TRELLIS → placed in the world, plus ElevenLabs sound. To (re)run it on a gallery
memory: `tsx --env-file=.env.local scripts/extras.ts <gallery_id>` (it resumes, never pays twice).

## Choosing the image-to-3D model

Compared on real crops (`scripts/compare-meshes.ts`, `/dev/mesh?files=...` to preview):

| Model | Price | Time | Size | Verdict |
|---|---|---|---|---|
| `trellis` (fal-ai/trellis) | **$0.02** | 25-50s | ~1.3 MB | **Default.** Good once given a clean cutout and the material fix below |
| `trellis-2` | $0.25 (512p) | ~90s | ~3 MB | Cleaner textures; the upgrade if quality matters more than cost |
| `hunyuan3d-v3` | $0.375 | ~145s | ~33 MB raw, ~1.2 MB compressed | Best geometry; practical once compressed |

Every finished mesh is then compressed (`lib/pipeline/optimize-glb.ts`: WebP textures at
1024px + meshopt): Hunyuan3D 32.6 → 1.2 MB, TRELLIS 1.5 → 0.15 MB, visually identical. That
makes `hunyuan3d-v3` practical for the web if its quality is worth $0.375.

What mattered more than the model:
- **A cutout of just the object.** Every model reconstructs whatever is in the image, so
  background left in a crop comes back as a slab. Generic background removal guesses "the
  subject" and can get it backwards (on a painted room it kept the room and cut out the
  kettle). SAM 3 cuts out the *named* object; BiRefNet is the fallback.
- **Materials.** All of these export `metallicFactor: 1`. Without a metalness map (TRELLIS v1
  has none) that's bare metal, which renders black. `lib/world/materials.ts` treats such
  materials as non-metal and adds a locally generated studio environment for reflections.
- **Erasing the splat under a mesh** must hug the object: a region as deep as the mesh cut
  holes in the wall behind a sewing machine, and one reaching down cut into the table under
  the lamp.

## Jev: decisions over the scene (`lib/ai/providers/real/jev.ts`)

Gemini describes the photo; Jev (TypeSafe's System One model) makes the calls that follow from
the description. It's text-only, returns calibrated probabilities, ~1s and ~$0.0001 a memory.
Code keeps the arithmetic (object size is bucketed in code) and the policy (thresholds, caps).

| Decision | Question | Policy |
|---|---|---|
| What each object becomes | Choice: `object3d` / `photo` / `world`, plus a Score for how much it matters to the memory | 3D objects need confidence ≥ 0.5 and the size rules; ranked by meaning; photo layers need ≥ 0.4 |
| No voices | Noul per sound prompt: would it contain an individual human voice? | > 0.5 → the sound is dropped before ElevenLabs is paid |
| Public gallery | Nouls: child undressed or bathing, nudity, medical, readable personal details | any > 0.5 → held for `scripts/gallery.ts approve <id>`; held entries can't be opened by link |

Why: Gemini's own labels were inconsistent between runs (the same sewing machine was "splat"
then "mesh"; the dining table and a bare light bulb were "mesh" both times). Jev's calls on the
same two readings matched each other at 0.88–1.00 confidence and picked only the lamp. Without
a key, everything falls back to the vision model's labels and gallery publishing is unscreened.
