# Demo memory

**"or enter a memory"** opens a real one: a 1946 photograph of a living room in Colorado
(Russell Lee for the U.S. Coal Mines Administration, NARA 540360, public domain), and the world
World Labs made from it. Everything is local in `public/demo/1946/` and `lib/demo/1946.json`:

| File | What |
|---|---|
| `photo.jpg` | the photograph (cropped from the negative scan) |
| `world-500k.spz` | the Marble world (500k splats). The full-resolution one loads from World Labs' CDN when online |
| `table-lamp.glb`, `sewing-machine-table.glb` | hero objects: SAM 3 cutout → TRELLIS |
| `ambient-*.mp3`, `positional-*.mp3` | ElevenLabs sound |

The camera (fov 45.05°, pitch −0.056) is the one calibration recovered from Marble's panorama.
Rebuild from any gallery memory:

```bash
tsx --env-file=.env.local scripts/bake-demo.ts <gallery_id> <name> <fov> <pitch> <yaw>
```

## The mock world

`AI_MODE=mock` "generates" the painted bedroom from Spark's examples
(`public/demo/painted-bedroom.spz`, `photo.jpg`, hand-written manifest in
`lib/demo/analysis.ts`, placeholder `object.glb`, sounds in `public/demo/audio/`) for any photo,
so the whole flow runs with no keys. Its "photograph" is a render of the world from a level 60°
camera (`scripts/capture-demo-photo.ts`, via `/dev/capture`).
