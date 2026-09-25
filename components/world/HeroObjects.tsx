"use client";

import { Html, useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import type { SplatMesh } from "@sparkjsdev/spark";
import { type RefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BoundingBox } from "@/lib/analysis/schema";
import type { OriginalCamera } from "@/lib/demo/memory";
import { objectHole } from "@/lib/world/holes";
import { fixGeneratedMaterial, roomEnvironment } from "@/lib/world/materials";
import type { Placement } from "@/lib/world/placement";
import type { WorldFx } from "./fx";
import type { Hole } from "./GaussianEnvironment";

export interface PlacedObject {
  id: string;
  label: string;
  description: string;
  bbox: BoundingBox;
  glbUrl: string;
  placement: Placement;
}

interface Props {
  objects: PlacedObject[];
  /** Objects appear with the world, never before it. */
  fx: RefObject<WorldFx>;
  camera: OriginalCamera;
  /** The world's splat and the photo's aspect: where the world's own copy of each object is. */
  splat: SplatMesh | null;
  photoAspect: number;
  onSelect: (id: string) => void;
  /** Reports the splat region each mesh now occupies, so it can be erased. */
  onHoles: (holes: Hole[]) => void;
  /** Objects whose evidence has been opened: their marker quiets down. */
  seen: ReadonlySet<string>;
}

/** Largest extent, in metres, of a hero object that isn't furniture (a lamp ~0.5; a table ~0.9). */
const MAX_OBJECT_M = 0.75;

/** A click, not the end of a drag-to-look. */
const CLICK_PX = 6;
const HOVER_EMISSIVE = new THREE.Color("#ffe2b8");

export function HeroObjects({
  objects,
  fx,
  camera,
  splat,
  photoAspect,
  onSelect,
  onHoles,
  seen,
}: Props) {
  const [holes, setHoles] = useState<Record<string, Hole>>({});
  const report = useRef(onHoles);
  report.current = onHoles;

  useEffect(() => {
    report.current(Object.values(holes));
  }, [holes]);

  return (
    <>
      {objects.map((o) => (
        <Suspense key={o.id} fallback={null}>
          <HeroObject
            object={o}
            fx={fx}
            seen={seen.has(o.id)}
            camera={camera}
            splat={splat}
            photoAspect={photoAspect}
            onSelect={onSelect}
            onPlaced={(hole) => setHoles((h) => ({ ...h, [o.id]: hole }))}
          />
        </Suspense>
      ))}
    </>
  );
}

function HeroObject({
  object,
  fx,
  seen,
  camera,
  splat,
  photoAspect,
  onSelect,
  onPlaced,
}: {
  object: PlacedObject;
  fx: RefObject<WorldFx>;
  seen: boolean;
  camera: OriginalCamera;
  splat: SplatMesh | null;
  photoAspect: number;
  onSelect: (id: string) => void;
  onPlaced: (hole: Hole) => void;
}) {
  const { scene } = useGLTF(object.glbUrl);
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => roomEnvironment(gl), [gl]);
  const group = useRef<THREE.Group>(null);
  const hovered = useRef(false);
  const glow = useRef(0);
  const appear = useRef(0);

  // Normalize the mesh: centred, scaled to the object's size in the photo, facing the camera.
  const { model, materials, transform } = useMemo(() => {
    const model = scene.clone(true);
    const materials: THREE.MeshStandardMaterial[] = [];
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
      for (const m of [mesh.material].flat()) {
        fixGeneratedMaterial(m);
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          const std = m as THREE.MeshStandardMaterial;
          std.transparent = true;
          std.envMap = env;
          materials.push(std);
        }
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    model.position.sub(centre);

    const { placement } = object;
    // Fit inside the box it occupies in the photo.
    const scale = Math.min(placement.width / (size.x || 1), placement.height / (size.y || 1));
    const origin = new THREE.Vector3(...camera.position);
    const toCamera = origin.clone().sub(placement.center);
    const yaw = Math.atan2(toCamera.x, toCamera.z);
    return { model, materials, transform: { scale, yaw, size: size.multiplyScalar(scale) } };
  }, [scene, object, camera, env]);

  // Placed, it has a real size. Furniture-sized meshes keep the world's copy of their lower
  // half: image-to-3D breaks on openwork like a treadle base, and the world's own legs behind
  // the mesh's shards read as the real thing.
  const furniture = Math.max(transform.size.x, transform.size.y, transform.size.z) > MAX_OBJECT_M;

  const placed = useRef(onPlaced);
  placed.current = onPlaced;
  useEffect(() => {
    // The world's own copy of the object, wherever it strayed to (see objectHole).
    if (!splat) return;
    placed.current(
      objectHole(
        splat,
        camera,
        photoAspect,
        object.id,
        object.bbox,
        object.placement.center.clone(),
        transform.size,
        furniture,
      ),
    );
  }, [object, transform, splat, camera, photoAspect, furniture]);

  const opaque = useRef(false);
  const marker = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState(false);
  useFrame((_, dt) => {
    appear.current = Math.min(1, appear.current + dt / 1.2);
    glow.current += ((hovered.current ? 1 : 0) - glow.current) * Math.min(1, dt * 8);
    const opacity = appear.current * fx.current.worldOpacity;
    if (group.current) group.current.visible = opacity > 0.001;
    // The marker waits for the world, and steps aside while the photograph is laid over it.
    if (marker.current) {
      marker.current.style.opacity = String(opacity * (1 - fx.current.photoOpacity));
    }
    // Fully in: render opaque, since transparent meshes sort badly against splats.
    const nowOpaque = opacity >= 0.999;
    const switched = nowOpaque !== opaque.current;
    opaque.current = nowOpaque;
    for (const m of materials) {
      m.opacity = opacity;
      if (switched) {
        m.transparent = !nowOpaque;
        m.needsUpdate = true;
      }
      m.emissive.copy(HOVER_EMISSIVE);
      m.emissiveIntensity = glow.current * 0.22;
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > CLICK_PX) return;
    e.stopPropagation();
    onSelect(object.id);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a three.js group, not a DOM element
    <group
      ref={group}
      position={object.placement.center}
      rotation={[0, transform.yaw, 0]}
      scale={transform.scale}
      onPointerOver={(e) => {
        e.stopPropagation();
        hovered.current = true;
        setHot(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        hovered.current = false;
        setHot(false);
        document.body.style.cursor = "";
      }}
      onClick={click}
      name={`hero-${object.id}`}
    >
      <primitive object={model} />
      {/* Just above the object, in its unscaled frame so it stays a constant size on screen. */}
      <Html
        position={[0, (transform.size.y / transform.scale) * 0.62, 0]}
        center
        zIndexRange={[15, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div ref={marker} className="hero-marker-wrap" style={{ opacity: 0 }}>
          <button
            type="button"
            className={`hero-marker ${seen ? "is-seen" : ""} ${hot ? "is-hot" : ""}`}
            onClick={(e) => {
              // Let go of focus, so the label doesn't linger after the evidence closes.
              e.currentTarget.blur();
              onSelect(object.id);
            }}
            onPointerEnter={() => {
              hovered.current = true;
              setHot(true);
            }}
            onPointerLeave={() => {
              hovered.current = false;
              setHot(false);
            }}
            aria-label={`${object.label}: see where it is in the photograph`}
          >
            <span className="hero-marker-ring" />
            <span className="hero-marker-label">{object.label}</span>
          </button>
        </div>
      </Html>
    </group>
  );
}
