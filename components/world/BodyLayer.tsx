"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OriginalCamera } from "@/lib/demo/memory";
import { cameraQuaternion } from "@/lib/world/placement";

export interface BodyModel {
  /** The person in 3D (lib/pipeline/person.ts), in its model's camera frame (three.js axes). */
  url: string;
  /** The vertical field of view that camera assumed, degrees. */
  fov: number;
}

interface Props {
  body: BodyModel;
  camera: OriginalCamera;
  /** How far along the original camera's view the person stands, from the splat. */
  depth: number;
  /** 0..1, set every frame by the photo layer. */
  opacity: RefObject<number>;
  /** World-space vertices of the placed model, once (for hiding the splat's figure). */
  onPlaced?: (points: Float32Array) => void;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// The model as generated, in its own texture (made from their photo). Drawn before the
// splats and opaque once fully in (see BodyLayer), so the room occludes it correctly.
const fragmentShader = /* glsl */ `
  uniform sampler2D own;
  uniform float hasOwn;
  uniform mat3 ownTransform;
  uniform vec3 ownColor;
  uniform float opacity;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 base = ownColor;
    if (hasOwn > 0.5) {
      // The texture has its own shading (it's made from the photo): only a touch more.
      base *= texture2D(own, (ownTransform * vec3(vUv, 1.0)).xy).rgb;
      base *= 0.86 + 0.14 * clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
    } else {
      // Untextured (the legs): a key light from above and the room, and a soft fill, so they
      // read as rounded limbs rather than flat grey.
      vec3 key = normalize(vec3(0.35, 0.8, 0.5));
      float lambert = max(dot(n, key), 0.0);
      float fill = 0.5 + 0.5 * n.y;
      base *= 0.42 + 0.5 * lambert + 0.18 * fill;
    }
    if (opacity < 0.01) discard;
    gl_FragColor = vec4(base, opacity);
    #include <colorspace_fragment>
  }
`;

function textureTransform(map: THREE.Texture | null) {
  if (!map) return new THREE.Matrix3();
  map.updateMatrix();
  return map.matrix.clone();
}

/** A person as a 3D model, standing where the photo shows them. */
export function BodyLayer({ body, camera, depth, opacity, onPlaced }: Props) {
  const { scene } = useGLTF(body.url);

  const parts = useMemo(() => {
    scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) meshes.push(n as THREE.Mesh);
    });
    // Compressed meshes store quantized positions with their scale on the node: bake every
    // node transform into full-precision floats before working in metres.
    const baked = meshes.map((m) => {
      const src = m.geometry.getAttribute("position");
      const floats = new Float32Array(src.count * 3);
      const p = new THREE.Vector3();
      for (let i = 0; i < src.count; i++) {
        p.fromBufferAttribute(src, i).applyMatrix4(m.matrixWorld);
        floats.set([p.x, p.y, p.z], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(floats, 3));
      const uv = m.geometry.getAttribute("uv");
      if (uv) {
        const uvs = new Float32Array(uv.count * 2);
        for (let i = 0; i < uv.count; i++) uvs.set([uv.getX(i), uv.getY(i)], i * 2);
        g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      } else {
        g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(src.count * 2), 2));
      }
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as
        | THREE.MeshStandardMaterial
        | undefined;
      return {
        geometry: g,
        map: mat?.map ?? null,
        color: mat?.color?.clone() ?? new THREE.Color(1, 1, 1),
      };
    });

    // 1. Field of view: re-project the model's camera into ours, so its silhouette lands on
    //    the photo. 2. Scale about the camera (projection-preserving) to the splat's depth.
    const k = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((body.fov * Math.PI) / 360);
    const depths: number[] = [];
    for (const { geometry } of baked) {
      const pos = geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) depths.push(-pos.getZ(i));
    }
    depths.sort((a, b) => a - b);
    const s = depth / depths[Math.floor(depths.length / 2)];
    // 3. Into the world: the original camera's orientation and position.
    const q = cameraQuaternion(camera);
    const o = new THREE.Vector3(...camera.position);
    const v = new THREE.Vector3();
    const all: number[] = [];
    for (const { geometry } of baked) {
      const pos = geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i) * k * s, pos.getY(i) * k * s, pos.getZ(i) * s)
          .applyQuaternion(q)
          .add(o);
        pos.setXYZ(i, v.x, v.y, v.z);
        if (i % 4 === 0) all.push(v.x, v.y, v.z);
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    }
    return { baked, points: new Float32Array(all) };
  }, [scene, body.fov, camera, depth]);

  const placed = useRef(onPlaced);
  placed.current = onPlaced;
  useEffect(() => {
    placed.current?.(parts.points);
  }, [parts]);

  const materials = useMemo(() => {
    // Shared by every part's material.
    const shared = { opacity: { value: 0 } };
    return parts.baked.map(
      ({ map, color }) =>
        new THREE.ShaderMaterial({
          uniforms: {
            ...shared,
            own: { value: map },
            hasOwn: { value: map ? 1 : 0 },
            // Quantized texture coordinates come with a transform on the texture.
            ownTransform: { value: textureTransform(map) },
            ownColor: { value: color },
          },
          vertexShader,
          fragmentShader,
          transparent: true,
          depthWrite: true,
          side: THREE.FrontSide,
        }),
    );
  }, [parts]);

  useEffect(
    () => () => {
      for (const m of materials) m.dispose();
    },
    [materials],
  );
  useEffect(
    () => () => {
      for (const { geometry } of parts.baked) geometry.dispose();
    },
    [parts],
  );

  useFrame(() => {
    const u = materials[0]?.uniforms;
    if (!u) return;
    const a = opacity.current ?? 0;
    u.opacity.value = a;
    // Fully in, it's opaque and drawn before the splats: the splats respect depth, so the room
    // in front of the person (a table before their legs) covers them from wherever you stand,
    // and whatever the world model left behind them is hidden by them.
    const opaque = a >= 0.999;
    for (const m of materials) {
      if (m.transparent === !opaque) continue;
      m.transparent = !opaque;
      m.needsUpdate = true;
    }
  });

  return (
    <group name="body-layer">
      {parts.baked.map(({ geometry }, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are fixed per model
          key={i}
          geometry={geometry}
          material={materials[i]}
          renderOrder={-1}
        />
      ))}
    </group>
  );
}
