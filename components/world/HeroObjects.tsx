"use client";

import { useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BoundingBox } from "@/lib/analysis/schema";
import type { OriginalCamera } from "@/lib/demo/memory";
import type { Placement } from "@/lib/world/placement";
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
  camera: OriginalCamera;
  onSelect: (id: string) => void;
  /** Reports the splat region each mesh now occupies, so it can be erased. */
  onHoles: (holes: Hole[]) => void;
}

/** A click, not the end of a drag-to-look. */
const CLICK_PX = 6;
const HOVER_EMISSIVE = new THREE.Color("#ffe2b8");

export function HeroObjects({ objects, camera, onSelect, onHoles }: Props) {
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
            camera={camera}
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
  camera,
  onSelect,
  onPlaced,
}: {
  object: PlacedObject;
  camera: OriginalCamera;
  onSelect: (id: string) => void;
  onPlaced: (hole: Hole) => void;
}) {
  const { scene } = useGLTF(object.glbUrl);
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
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          const std = m as THREE.MeshStandardMaterial;
          std.transparent = true;
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
  }, [scene, object, camera]);

  const placed = useRef(onPlaced);
  placed.current = onPlaced;
  useEffect(() => {
    placed.current({
      id: object.id,
      center: object.placement.center.clone(),
      // A little larger than the mesh, so none of the old splat version shows around it.
      size: transform.size.clone().multiplyScalar(0.8),
    });
  }, [object, transform]);

  useFrame((_, dt) => {
    const wasFading = appear.current < 1;
    appear.current = Math.min(1, appear.current + dt / 1.2);
    glow.current += ((hovered.current ? 1 : 0) - glow.current) * Math.min(1, dt * 8);
    for (const m of materials) {
      m.opacity = appear.current;
      // Once fully in, render opaque: transparent meshes sort badly against splats.
      if (wasFading && appear.current >= 1) {
        m.transparent = false;
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
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        hovered.current = false;
        document.body.style.cursor = "";
      }}
      onClick={click}
      name={`hero-${object.id}`}
    >
      <primitive object={model} />
    </group>
  );
}
