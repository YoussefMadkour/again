"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import type { SplatMesh } from "@sparkjsdev/spark";
import { type RefObject, Suspense, useMemo, useRef, useState } from "react";
import type { Memory } from "@/lib/demo/memory";
import type { PublicExtras } from "@/lib/pipeline/extras";
import type { CardRect } from "@/lib/world/entry";
import { type Placement, placeBox } from "@/lib/world/placement";
import { CameraController, type WorldMode } from "./CameraController";
import { createWorldFx } from "./fx";
import { GaussianEnvironment, type Hole } from "./GaussianEnvironment";
import { HeroObjects, type PlacedObject } from "./HeroObjects";
import { type PhotoLayerInput, PhotoLayers } from "./PhotoLayers";
import { PhotoPlane } from "./PhotoPlane";
import {
  createProvenanceUniforms,
  type ProvenanceUniforms,
  setProvenanceCamera,
} from "./provenance";
import { type PlacedSound, SpatialAudio } from "./SpatialAudio";

interface Props {
  memory: Memory;
  /** Objects and sound, as they arrive. */
  extras?: PublicExtras;
  mode: WorldMode;
  card: RefObject<CardRect | null>;
  returnSignal: number;
  muted: boolean;
  onLoaded: () => void;
  onError: (error: unknown) => void;
  onEntered: () => void;
  onSelectObject: (id: string) => void;
  /** 0 = MEMORY, 1 = DREAM. */
  dream: number;
  /** SPACE held: reveal provenance. */
  revealing: boolean;
  /** Input is ignored while an overlay is up. */
  frozen: boolean;
  onBeyond: () => void;
  /** Hero objects whose evidence has been opened. */
  seenObjects: ReadonlySet<string>;
}

export default function MemoryWorld({
  memory,
  extras,
  mode,
  card,
  returnSignal,
  muted,
  onLoaded,
  onError,
  onEntered,
  onSelectObject,
  dream,
  revealing,
  frozen,
  onBeyond,
  seenObjects,
}: Props) {
  const fx = useRef(createWorldFx());
  const capture = mode === "capture";
  const [splat, setSplat] = useState<SplatMesh | null>(null);
  const [objectHoles, setObjectHoles] = useState<Hole[]>([]);
  const [layerHoles, setLayerHoles] = useState<Hole[]>([]);
  const holes = useMemo(() => [...objectHoles, ...layerHoles], [objectHoles, layerHoles]);
  const dreamRef = useRef(dream);
  dreamRef.current = dream;
  const layers = useMemo<PhotoLayerInput[]>(
    () =>
      (extras?.layers ?? []).flatMap((l) =>
        l.state === "done" && l.url
          ? [{ id: l.id, kind: l.kind, bbox: l.imageBox ?? l.bbox, url: l.url, body: l.body }]
          : [],
      ),
    [extras],
  );
  const provenance = useMemo(() => {
    const u = createProvenanceUniforms();
    setProvenanceCamera(u, memory.originalCamera, memory.photoAspect);
    return u;
  }, [memory]);
  // Raycasting is the expensive part, and extras update on every poll: place each thing once.
  const placed = useRef(new Map<string, Placement | null>());
  const place = (id: string, bbox: Parameters<typeof placeBox>[3]) => {
    if (!splat) return null;
    if (!placed.current.has(id)) {
      const p = placeBox(splat, memory.originalCamera, memory.photoAspect, bbox);
      placed.current.set(id, p);
      console.info(
        "[again] placed",
        id,
        p ? `${p.distance.toFixed(2)}m away` : "not found in the world",
      );
    }
    return placed.current.get(id) ?? null;
  };

  // Place each finished object and sound where the photo shows it, by raycasting the splat.
  // biome-ignore lint/correctness/useExhaustiveDependencies: place() is cached per memory
  const objects = useMemo<PlacedObject[]>(() => {
    if (!splat || !extras) return [];
    return extras.objects.flatMap((o) => {
      if (o.state !== "done" || !o.glbUrl) return [];
      const placement = place(o.id, o.bbox);
      return placement ? [{ ...o, glbUrl: o.glbUrl, placement }] : [];
    });
  }, [splat, extras]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: place() is cached per memory
  const sounds = useMemo<PlacedSound[]>(() => {
    if (!extras) return [];
    return extras.sounds.flatMap((s): PlacedSound[] => {
      if (s.state !== "done" || !s.url) return [];
      if (s.kind === "ambient" || !s.bbox) return [{ id: s.id, url: s.url, position: null }];
      const placement = place(s.id, s.bbox);
      return placement ? [{ id: s.id, url: s.url, position: placement.center }] : [];
    });
  }, [splat, extras]);

  return (
    <Canvas
      flat
      dpr={capture ? 1 : [1, 1.75]}
      gl={{ antialias: false, preserveDrawingBuffer: capture }}
      camera={{ fov: memory.originalCamera.fov, near: 0.01, far: 200 }}
      onCreated={({ gl }) => gl.setClearColor("#000000", 1)}
      style={{ touchAction: "none" }}
      data-testid="memory-world"
    >
      <GaussianEnvironment
        url={memory.splatUrl}
        upgradeUrl={memory.splatUpgradeUrl}
        holdUpgrade={mode === "entering"}
        quaternion={memory.splatQuaternion}
        scale={memory.splatScale}
        fx={fx}
        onLoaded={onLoaded}
        onError={onError}
        onMesh={setSplat}
        holes={holes}
        provenance={capture ? undefined : provenance}
      />
      <ProvenanceDriver uniforms={provenance} dream={dream} revealing={revealing} mode={mode} />
      {!capture && (
        <>
          <Suspense fallback={null}>
            <PhotoPlane
              url={memory.photoUrl}
              aspect={memory.photoAspect}
              camera={memory.originalCamera}
              fx={fx}
            />
          </Suspense>
          <ambientLight intensity={0.9} />
          <directionalLight position={[1.5, 3, 2]} intensity={1.4} />
          {splat && layers.length > 0 && (
            <PhotoLayers
              layers={layers}
              splat={splat}
              camera={memory.originalCamera}
              photoAspect={memory.photoAspect}
              fx={fx}
              dream={dreamRef}
              onHoles={setLayerHoles}
              provenance={provenance}
            />
          )}
          <HeroObjects
            objects={objects}
            fx={fx}
            camera={memory.originalCamera}
            onSelect={onSelectObject}
            onHoles={setObjectHoles}
            seen={seenObjects}
          />
          <SpatialAudio sounds={sounds} fx={fx} muted={muted} />
        </>
      )}
      <CameraController
        mode={mode}
        original={memory.originalCamera}
        card={card}
        fx={fx}
        returnSignal={returnSignal}
        onEntered={onEntered}
        frozen={frozen}
        onBeyond={onBeyond}
        photoAspect={memory.photoAspect}
      />
    </Canvas>
  );
}

/** Eases the MEMORY <-> DREAM and reveal values toward their targets, every frame. */
function ProvenanceDriver({
  uniforms,
  dream,
  revealing,
  mode,
}: {
  uniforms: ProvenanceUniforms;
  dream: number;
  revealing: boolean;
  mode: string;
}) {
  useFrame((_, dt) => {
    // Before and during the entry the world is shown whole; the slider applies once inside.
    const targetDream = mode === "exploring" ? dream : 1;
    const targetReveal = mode === "exploring" && revealing ? 1 : 0;
    const k = 1 - Math.exp(-dt * 5);
    uniforms.dream.value += (targetDream - uniforms.dream.value) * k;
    uniforms.reveal.value += (targetReveal - uniforms.reveal.value) * (1 - Math.exp(-dt * 4));
  });
  return null;
}
