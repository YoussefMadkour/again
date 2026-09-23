# Demo memory

`public/demo/`:

| File | What |
|---|---|
| `painted-bedroom.spz` | Marble-generated world, from Spark's public example assets (`forge-dev-public/painted_bedroom.spz`) |
| `photo.jpg` | The "photograph": the world rendered from its original camera (origin, looking -Z, 60° fov, 4:3), then aged (sepia, lifted blacks, light leak, vignette, grain) |

Config lives in `lib/demo/memory.ts` (`DEMO_MEMORY`).

## Regenerating the photo

```bash
pnpm dev
node scripts/capture-demo-photo.mjs
```

This opens `/dev/capture` (dev-only; 404 in production), which renders the splat from
`originalCamera` at 1600×1200, applies the aging, and writes `public/demo/photo.jpg`.
Change `originalCamera` in `lib/demo/memory.ts` and re-run if you move the viewpoint.

## Swapping in a different world

1. Put the `.spz` in `public/demo/` and point `splatUrl` at it.
2. Set `originalCamera` to the viewpoint the world was generated from (for Marble worlds
   that's the origin, looking down -Z).
3. Regenerate the photo, or supply the real source photo and match `photoAspect` and `fov` to it.
