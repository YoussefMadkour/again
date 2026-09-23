"use client";

import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type RefObject, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OriginalCamera } from "@/lib/demo/memory";
import { PHOTO_DISTANCE, photoPlaneHeight } from "@/lib/world/entry";
import type { WorldFx } from "./fx";

interface Props {
  url: string;
  aspect: number;
  camera: OriginalCamera;
  fx: RefObject<WorldFx>;
}

/** Widest edge falloff, as a fraction of the photo's width/height. */
const MAX_FEATHER = 0.16;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Edges soften as the camera arrives, so the print melts into the world around it.
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float opacity;
  uniform float feather;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(map, vUv);
    vec2 edge = min(vUv, 1.0 - vUv);
    float f = max(feather, 1e-4);
    float mask = smoothstep(0.0, f, edge.x) * smoothstep(0.0, f, edge.y);
    gl_FragColor = vec4(color.rgb, color.a * opacity * mix(1.0, mask, step(1e-4, feather)));
    #include <colorspace_fragment>
  }
`;

/** The photograph as a physical plane at the original camera's image plane. */
export function PhotoPlane({ url, aspect, camera, fx }: Props) {
  const texture = useTexture(url);
  texture.colorSpace = THREE.SRGBColorSpace;

  const { position, quaternion, width, height } = useMemo(() => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...camera.rotation, "YXZ"));
    const p = new THREE.Vector3(0, 0, -PHOTO_DISTANCE)
      .applyQuaternion(q)
      .add(new THREE.Vector3(...camera.position));
    const h = photoPlaneHeight(camera.fov);
    return { position: p, quaternion: q, width: h * aspect, height: h };
  }, [camera, aspect]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: texture },
          opacity: { value: 1 },
          feather: { value: 0 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [texture],
  );

  const mesh = useRef<THREE.Mesh>(null);

  useFrame(({ camera: view }) => {
    const m = mesh.current;
    if (m) {
      if (fx.current.photoGlued) {
        m.position.set(0, 0, -PHOTO_DISTANCE).applyQuaternion(view.quaternion).add(view.position);
        m.quaternion.copy(view.quaternion);
      } else {
        m.position.copy(position);
        m.quaternion.copy(quaternion);
      }
    }
    material.uniforms.opacity.value = fx.current.photoOpacity;
    material.uniforms.feather.value = fx.current.photoFeather * MAX_FEATHER;
  });

  return (
    <mesh
      ref={mesh}
      position={position}
      quaternion={quaternion}
      renderOrder={10}
      material={material}
      visible
      onUpdate={(m) => {
        m.frustumCulled = false;
      }}
    >
      <planeGeometry args={[width, height]} />
    </mesh>
  );
}
