# AGAIN.

**Step inside a memory.** Upload a photograph, watch the camera pass through it, and find yourself standing inside the place, with a clear line between what the photo showed and what AI imagined.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000, mock mode, no API keys needed
```

Drop a photo, or choose **or enter a memory** for the demo. Press **STEP INSIDE** (or Enter). Then:

| Input | Does |
|---|---|
| drag | look |
| W A S D / arrows | move (gently, within the room) |
| scroll | drift forward / back |
| Esc | return to the photograph's viewpoint |

## Status

### Access, own keys, gallery ✅

- Generating on the owner's key needs an **access code** (each with its own quota). "ask for a
  trial" links to the owner's DMs. Or visitors paste **their own World Labs key**.
- Rate limits per code, per IP per hour, and a global daily cap, in Upstash Redis (or a local file).
- **Gallery** below the drop zone: memories whose makers opted in. Photo first, the world on
  hover, free to open (`/?memory=<id>`).

### Milestone 2 (real photos) ✅

- Drop a photo (jpg/png/webp, ≤15 MB). It's EXIF-rotated, downsized to 2048px and re-encoded
  (which strips GPS metadata), then sent to World Labs Marble.
- Processing keeps the photo on screen with experiential copy, not progress bars.
- When the world arrives, the photo's original camera is **recovered automatically** from
  Marble's panorama, so the photo lines up with its world at the crossing.
- A generation survives a reload. "or enter a memory" opens the demo.
- `AI_MODE=mock` (default) runs the whole flow with no keys. See [`docs/SWAP_TO_REAL.md`](docs/SWAP_TO_REAL.md).

### Milestone 1 (vertical slice) ✅

- Demo memory renders: pre-generated World Labs Marble `.spz` → Spark → Three.js / R3F
- The entry transition: DOM print → 3D photo plane (pixel-matched handoff) → camera approaches → world opens around the photo's feathered edges → photo dissolves as the camera crosses its plane → free camera
- Single screen, state machine (no routes)
- Return to photo (Esc / button) lays the photograph back over the world at the original viewpoint

Next (Milestone 3): vision model → scene manifest → hero objects (FAL) + ambient audio (ElevenLabs).

## Scripts

| | |
|---|---|
| `pnpm test` | unit tests (state machine, entry choreography, handoff geometry) |
| `pnpm test:e2e` | Playwright: upload → processing → ready → step inside → move → return. Own server on :3100, always mock. System Chrome for GPU WebGL |
| `pnpm lint` / `pnpm typecheck` | Biome / tsc |
| `node scripts/capture-demo-photo.mjs` | re-render the demo photograph from the world (needs `pnpm dev`) |

Docs: [`ROADMAP`](docs/ROADMAP.md) · [`ARCHITECTURE`](docs/ARCHITECTURE.md) · [`PROVIDERS`](docs/PROVIDERS.md) · [`SWAP_TO_REAL`](docs/SWAP_TO_REAL.md) · [`DEMO`](docs/DEMO.md)

Test photo: `tests/fixtures/living-room-1946.jpg`, Russell Lee for the U.S. Coal Mines
Administration (NARA 540360, public domain), cropped.
