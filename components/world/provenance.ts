"use client";

import { dyno, type GsplatModifier } from "@sparkjsdev/spark";
import * as THREE from "three";
import type { OriginalCamera } from "@/lib/demo/memory";
import { cameraQuaternion } from "@/lib/world/placement";

/**
 * Per-splat provenance, on the GPU. Each splat is projected into the original camera:
 *
 *   observed   inside the photograph's frame
 *   inferred   a band just past its edges, where the model extends what's visible
 *   imagined   everything else (behind the camera, far outside the frame)
 *
 * It's a frustum test, so things hidden *behind* something in the photo still count as
 * observed. Good enough to show where the photograph ends; honest about being approximate.
 *
 * Two controls:
 *   dream   0 = MEMORY: unseen space fades to a dim, colourless fog. 1 = DREAM: the whole world.
 *   reveal  0..1 while SPACE is held: observed warms, imagined cools, the frame's edge glows.
 */
export interface ProvenanceUniforms {
  worldToCamera: ReturnType<typeof dyno.dynoMat3<THREE.Matrix3>>;
  tanHalf: ReturnType<typeof dyno.dynoFloat>;
  aspect: ReturnType<typeof dyno.dynoFloat>;
  dream: ReturnType<typeof dyno.dynoFloat>;
  reveal: ReturnType<typeof dyno.dynoFloat>;
}

export function createProvenanceUniforms(): ProvenanceUniforms {
  return {
    worldToCamera: dyno.dynoMat3(new THREE.Matrix3()),
    tanHalf: dyno.dynoFloat(Math.tan(Math.PI / 6)),
    aspect: dyno.dynoFloat(4 / 3),
    dream: dyno.dynoFloat(1),
    reveal: dyno.dynoFloat(0),
  };
}

export function setProvenanceCamera(u: ProvenanceUniforms, camera: OriginalCamera, aspect: number) {
  const inverse = cameraQuaternion(camera).invert();
  u.worldToCamera.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(inverse));
  u.tanHalf.value = Math.tan((camera.fov * Math.PI) / 360);
  u.aspect.value = aspect;
}

export function provenanceModifier(u: ProvenanceUniforms): GsplatModifier {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat,
        worldToCamera: "mat3",
        tanHalf: "float",
        aspect: "float",
        dream: "float",
        reveal: "float",
      },
      outTypes: { gsplat: dyno.Gsplat },
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(/* glsl */ `
          ${outputs.gsplat} = ${inputs.gsplat};
          // The original camera sits at the world origin.
          vec3 c = ${inputs.worldToCamera} * ${inputs.gsplat}.center;
          float ahead = step(0.0, -c.z);
          vec2 ndc = c.xy / max(-c.z, 1e-3) / vec2(${inputs.tanHalf} * ${inputs.aspect}, ${inputs.tanHalf});
          // 1.0 at the photograph's edge.
          float edge = max(abs(ndc.x), abs(ndc.y));
          float observed = ahead * (1.0 - smoothstep(0.94, 1.06, edge));
          float imagined = 1.0 - ahead * (1.0 - smoothstep(1.3, 1.85, edge));
          float inferred = clamp(1.0 - observed - imagined, 0.0, 1.0);

          vec4 rgba = ${inputs.gsplat}.rgba;
          float lum = dot(rgba.rgb, vec3(0.299, 0.587, 0.114));

          // MEMORY <-> DREAM. Imagined space recedes most, inferred halfway.
          float unseen = imagined + inferred * 0.5;
          float memory = (1.0 - ${inputs.dream}) * unseen;
          rgba.rgb = mix(rgba.rgb, vec3(lum) * 0.3, memory * 0.9);
          rgba.a *= 1.0 - memory * 0.7;

          // Hold SPACE: what the photograph saw, what the model inferred, what it imagined.
          float r = ${inputs.reveal};
          rgba.rgb = mix(rgba.rgb, rgba.rgb * vec3(1.1, 1.0, 0.86) + vec3(0.04, 0.03, 0.0), r * observed);
          rgba.rgb = mix(rgba.rgb, vec3(lum) * vec3(0.72, 0.62, 0.5), r * inferred * 0.6);
          rgba.rgb = mix(rgba.rgb, vec3(lum) * vec3(0.42, 0.52, 0.75), r * imagined * 0.85);
          // A thin glow where the photograph ends.
          rgba.rgb += r * ahead * exp(-abs(edge - 1.0) * 22.0) * vec3(0.55, 0.48, 0.36);

          ${outputs.gsplat}.rgba = rgba;
        `),
    });
    return {
      gsplat: d.apply({
        gsplat,
        worldToCamera: u.worldToCamera,
        tanHalf: u.tanHalf,
        aspect: u.aspect,
        dream: u.dream,
        reveal: u.reveal,
      }).gsplat,
    };
  });
}

/** How far outside the photograph a view direction points (1.0 = the frame's edge). */
export function directionEdge(camera: OriginalCamera, aspect: number, direction: THREE.Vector3) {
  const c = direction.clone().applyQuaternion(cameraQuaternion(camera).invert());
  if (c.z >= -1e-3) return Number.POSITIVE_INFINITY;
  const t = Math.tan((camera.fov * Math.PI) / 360);
  return Math.max(Math.abs(c.x / -c.z / (t * aspect)), Math.abs(c.y / -c.z / t));
}
