"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type RefObject, useMemo } from "react";
import * as THREE from "three";
import type { BoundingBox } from "@/lib/analysis/schema";
import type { OriginalCamera } from "@/lib/demo/memory";
import { cameraQuaternion } from "@/lib/world/placement";

export interface BodyModel {
  /** SAM 3D Body mesh of this person, in its own camera frame (three.js axes). */
  url: string;
  /** The vertical field of view SAM 3D Body assumed, degrees. */
  fov: number;
}

interface Props {
  body: BodyModel;
  camera: OriginalCamera;
  aspect: number;
  /** The person's cutout (transparent PNG) and the photo region it covers. */
  texture: THREE.Texture;
  imageBox: BoundingBox;
  /** How far along the original camera's view the person stands, from the splat. */
  depth: number;
  /** 0..1, set every frame by the photo layer. */
  opacity: RefObject<number>;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// The photograph, projected from the original camera onto the body: every surface shows
// what the photo saw there, and fades by how squarely it faced the camera (the far side of
// the person was never captured).
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec4 box;
  uniform mat3 worldToCamera;
  uniform vec3 origin;
  uniform float tanHalf;
  uniform float aspect;
  uniform float opacity;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 c = worldToCamera * (vWorld - origin);
    if (c.z >= 0.0) discard;
    vec2 ndc = c.xy / -c.z / vec2(tanHalf * aspect, tanHalf);
    vec2 photo = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    vec2 uv = (photo - box.xy) / (box.zw - box.xy);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
    vec4 color = texture2D(map, vec2(uv.x, 1.0 - uv.y));
    float facing = dot(normalize(vNormal), normalize(origin - vWorld));
    float a = color.a * smoothstep(0.05, 0.4, facing) * opacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(color.rgb, a);
    #include <colorspace_fragment>
  }
`;

/** A person as a 3D body wearing their own photograph: convincing at wider angles than a cutout. */
export function BodyLayer({ body, camera, aspect, texture, imageBox, depth, opacity }: Props) {
  const { scene } = useGLTF(body.url);

  const geometry = useMemo(() => {
    let found: THREE.Mesh | null = null;
    scene.updateMatrixWorld(true);
    scene.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh && !found) found = m;
    });
    if (!found) return null;
    const source = found as THREE.Mesh;
    // Compressed meshes store quantized positions with their scale on the node: bake the
    // node transform into full-precision floats before working in metres.
    const quantized = source.geometry.getAttribute("position");
    const floats = new Float32Array(quantized.count * 3);
    const p = new THREE.Vector3();
    for (let i = 0; i < quantized.count; i++) {
      p.fromBufferAttribute(quantized, i).applyMatrix4(source.matrixWorld);
      floats.set([p.x, p.y, p.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(floats, 3));
    if (source.geometry.index) g.setIndex(source.geometry.index.clone());
    const pos = g.getAttribute("position");
    // 1. Field of view: re-project SAM's camera into ours, so the silhouette lands on the photo.
    const k = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((body.fov * Math.PI) / 360);
    // 2. Scale about the camera (projection-preserving) to the depth the splat has her at.
    const depths: number[] = [];
    for (let i = 0; i < pos.count; i++) depths.push(-pos.getZ(i));
    depths.sort((a, b) => a - b);
    const s = depth / depths[Math.floor(depths.length / 2)];
    // 3. Into the world: the original camera's orientation and position.
    const q = cameraQuaternion(camera);
    const o = new THREE.Vector3(...camera.position);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i) * k * s, pos.getY(i) * k * s, pos.getZ(i) * s)
        .applyQuaternion(q)
        .add(o);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [scene, body.fov, camera, depth]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: texture },
          box: { value: new THREE.Vector4(...imageBox) },
          worldToCamera: {
            value: new THREE.Matrix3().setFromMatrix4(
              new THREE.Matrix4().makeRotationFromQuaternion(cameraQuaternion(camera).invert()),
            ),
          },
          origin: { value: new THREE.Vector3(...camera.position) },
          tanHalf: { value: Math.tan((camera.fov * Math.PI) / 360) },
          aspect: { value: aspect },
          opacity: { value: 0 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: true,
        side: THREE.FrontSide,
      }),
    [texture, imageBox, camera, aspect],
  );

  useFrame(() => {
    material.uniforms.opacity.value = opacity.current ?? 0;
  });

  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} renderOrder={5} name="body-layer" />;
}
