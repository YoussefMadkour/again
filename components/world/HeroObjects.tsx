"use client";

import { useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BoundingBox } from "@/lib/analysis/schema";
import type { OriginalCamera } from "@/lib/demo/memory";
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
  onSelect: (id: string) => void;
  /** Reports the splat region each mesh now occupies, so it can be erased. */
  onHoles: (holes: Hole[]) => void;
}

/** A click, not the end of a drag-to-look. */
const CLICK_PX = 6;
const HOVER_EMISSIVE = new THREE.Color("#ffe2b8");

export function HeroObjects({ objects, fx, camera, onSelect, onHoles }: Props) {
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
  fx,
  camera,
  onSelect,
  onPlaced,
}: {
  object: PlacedObject;
  fx: RefObject<WorldFx>;
  camera: OriginalCamera;
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

  const placed = useRef(onPlaced);
  placed.current = onPlaced;
  useEffect(() => {
    // Erase the splat's own copy of the object, and nothing else: an ellipsoid hugging the mesh,
    // shallow in depth (objects usually stand against walls) and lifted a little so the surface
    // it rests on stays. Half extents; the mesh's own size is its full extent.
    const { size } = transform;
    placed.current({
      id: object.id,
      center: object.placement.center.clone().add(new THREE.Vector3(0, size.y * 0.06, 0)),
      size: new THREE.Vector3(size.x * 0.52, size.y * 0.46, Math.min(size.z, size.x) * 0.38),
    });
  }, [object, transform]);

  const opaque = useRef(false);
  useFrame((_, dt) => {
    appear.current = Math.min(1, appear.current + dt / 1.2);
    glow.current += ((hovered.current ? 1 : 0) - glow.current) * Math.min(1, dt * 8);
    const opacity = appear.current * fx.current.worldOpacity;
    if (group.current) group.current.visible = opacity > 0.001;
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
