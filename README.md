# AGAIN.

**Step inside a memory.** Upload a photograph, watch the camera pass through it, and find yourself standing inside the place, with a clear line between what the photo showed and what AI imagined.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000, no API keys needed
```

Press **STEP INSIDE** (or Enter). Then:

| Input | Does |
|---|---|
| drag | look |
| W A S D / arrows | move (gently, within the room) |
| scroll | drift forward / back |
| Esc | return to the photograph's viewpoint |

## Status: Milestone 1 (vertical slice) ✅

- Demo memory renders: pre-generated World Labs Marble `.spz` → Spark → Three.js / R3F
- The entry transition: DOM print → 3D photo plane (pixel-matched handoff) → camera approaches → world opens around the photo's feathered edges → photo dissolves as the camera crosses its plane → free camera
- Single screen, state machine (no routes)
- Return to photo (Esc / button) lays the photograph back over the world at the original viewpoint

Next (Milestone 2): real upload → World Labs → `.spz` → this same viewer.

## Scripts

| | |
|---|---|
| `pnpm test` | unit tests (state machine, entry choreography, handoff geometry) |
| `pnpm test:e2e` | Playwright: photo → step inside → world → look/move → return (uses system Chrome for GPU WebGL) |
| `pnpm lint` / `pnpm typecheck` | Biome / tsc |
| `node scripts/capture-demo-photo.mjs` | re-render the demo photograph from the world (needs `pnpm dev`) |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/DEMO.md`](docs/DEMO.md).
