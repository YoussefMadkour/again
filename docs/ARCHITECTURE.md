# Architecture

One page, one full-viewport canvas, one DOM overlay. UX is driven by `ExperienceState`
(`lib/experience/state.ts`), never by routes.

```
app/page.tsx
└── Experience                 components/experience/Experience.tsx
    ├── DOM overlay            title, print-bordered photo, "memory ready", STEP INSIDE, HUD
    └── MemoryWorld (R3F)      components/world/MemoryWorld.tsx   (client-only, dynamic import)
        ├── GaussianEnvironment   Spark SparkRenderer + SplatMesh, created imperatively
        ├── PhotoPlane            the photograph at the original camera's image plane
        └── CameraController      entry choreography + free camera + return-to-photo
```

## Making a memory (Milestone 2)

```
drop photo ─► preparePhoto (EXIF rotate, ≤2048px, re-encode)      lib/experience/memory-client.ts
          ─► POST /api/world ─► WorldProvider.create             app/api/world/route.ts
          ─► poll GET /api/world/:job every 4s                   app/api/world/[jobId]/route.ts
          ─► buildMemory: calibrate camera from pano             lib/world/calibrate*.ts
          ─► ready: MemoryWorld loads the splat, then STEP INSIDE
```

There's no database. The job id and the photo live in the browser (sessionStorage, so a reload
resumes). The server is stateless and proxies to the provider with the secret key.

## The entry transition

The photograph exists twice: as an `<img>` in the DOM and as a plane in the 3D scene placed
1 unit in front of the original camera, sized to exactly fill its vertical fov.

1. **Ready.** Every frame, `handoffOffset()` (`lib/world/entry.ts`) puts the 3D camera behind the
   original viewpoint at the exact distance/offset where the plane covers the same pixels as the
   `<img>`. The world is at opacity 0, so the canvas shows the identical photo on black.
2. **Step inside.** The print border and DOM photo fade out. Because the canvas underneath is
   pixel-identical, nothing visibly changes.
3. **Approach** (0 → 2.4s). The camera eases to the original viewpoint. From 1.45s the splat fades
   in and the plane's edges feather, so the room opens up around the print.
4. **Cross** (2.5 → 3.2s). From the moment the camera arrives, the photo rides with the camera
   (`photoGlued`), so it dissolves in place while the world starts moving behind it. Leaving it at
   its real depth caused a heavy double exposure on real worlds, where the walls sit ~3× further
   away than the photo plane.
5. **Explore** (3.8s). Control is handed over.

All per-frame values (world opacity, photo opacity, feather) live in a mutable `WorldFx` ref,
written by `CameraController` and read by the other components in `useFrame`, not in React state.

## Controls

Yaw/pitch are relative to the original camera's orientation, and movement is on the horizontal
plane of the current look direction. Everything is exponentially damped. A soft spring keeps you
within `ROOM_RADIUS` (2.2 units) of where the photo was taken, because Marble worlds degrade
quickly further out.

## Spark notes

- `SplatMesh` starts loading in its constructor, so it's created in an effect, not via JSX `args`.
- Spark only finishes initializing meshes it's asked to render, so the mesh stays `visible`
  (at opacity 0) until `isInitialized`.
- Marble exports are Y-down: the splat gets quaternion `(1, 0, 0, 0)`.
