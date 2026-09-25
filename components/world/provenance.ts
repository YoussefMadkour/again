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
  /**
   * Where people are in the photo (alpha, photo space). While a person's photo layer shows,
   * the splat's own blank-faced copy of them is hidden there, so the two don't ghost.
   */
  peopleMask: ReturnType<typeof dyno.dynoSampler2D<THREE.Texture>>;
  /** 0..1, how visible the person layers are right now. */
  peopleStrength: ReturnType<typeof dyno.dynoFloat>;
  /** The people's depth in the original camera (metres along its view). */
  peopleDepth: ReturnType<typeof dyno.dynoFloat>;
  /**
   * The world model's figure of the person, as an upright capsule (x, z, radius, active) and
   * its height range (yMin, yMax). When active, hiding is confined to it (see figure.ts).
   */
  peopleCapsule: ReturnType<typeof dyno.dynoVec4<THREE.Vector4>>;
  peopleHeight: ReturnType<typeof dyno.dynoVec2<THREE.Vector2>>;
  /**
   * With a person's 3D model in place: its nearest depth along the original camera (0 = no
   * model). Then the head-and-shoulders band of the capsule behind that is hidden, silhouette
   * or not; what stands in front of the person stays.
   */
  peopleFront: ReturnType<typeof dyno.dynoFloat>;
  /** And its farthest (plus a margin): the wall behind the person is never hidden. */
  peopleBack: ReturnType<typeof dyno.dynoFloat>;
  /** The holes (see Hole), packed four texels a row; and how many. */
  holes: ReturnType<typeof dyno.dynoSampler2D<THREE.Texture>>;
  holeCount: ReturnType<typeof dyno.dynoFloat>;
}

/**
 * Something we draw ourselves, and the world model's own copy of it to remove. The copy sits
 * a few centimetres off ours (in place and depth), so it's found the way the original camera
 * sees it: every splat inside the thing's (grown) box in the photograph, and near where it
 * stands.
 *
 *   wall     a photo layer on a wall: splats near the wall's plane are repainted the wall's
 *            colour (erasing them would open a hole, there's nothing behind a wall); or,
 *            for a person's shadow on the wall behind them, only the splats darker than it
 *   object   a hero mesh: splats within its reach and depth are erased (the wall behind
 *            stays; so does the surface it rests on, below `floor`)
 */
export type Hole = {
  id: string;
  /** Photo space, 0..1, [x0, y0, x1, y1]. */
  box: readonly [number, number, number, number];
  center: THREE.Vector3;
} & (
  | {
      kind: "wall";
      normal: THREE.Vector3;
      thickness: number;
      color: THREE.Color;
      /** Only splats darker than the wall (a shadow on it); the rest are left as they are. */
      shadowOnly?: boolean;
    }
  | { kind: "object"; radius: number; front: number; back: number; floor: number }
  /** A region shadow repaints leave alone (a picture on the wall near a person). */
  | { kind: "keep" }
);

export const MAX_HOLES = 32;

export function setHoles(u: ProvenanceUniforms, holes: Hole[]) {
  const data = new Float32Array(4 * 4 * MAX_HOLES);
  const list = holes.slice(0, MAX_HOLES);
  list.forEach((h, i) => {
    const o = i * 16;
    data.set(h.box, o);
    if (h.kind === "wall") {
      data.set([h.center.x, h.center.y, h.center.z, h.thickness], o + 4);
      data.set([h.normal.x, h.normal.y, h.normal.z, 0], o + 8);
      data.set([h.color.r, h.color.g, h.color.b, h.shadowOnly ? 2 : 1], o + 12);
    } else if (h.kind === "keep") {
      data.set([0, 0, 0, 3], o + 12);
    } else {
      data.set([h.center.x, h.center.y, h.center.z, h.radius], o + 4);
      data.set([h.floor, h.front, h.back, 1], o + 8);
    }
  });
  const texture = new THREE.DataTexture(data, 4, MAX_HOLES, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  const previous = u.holes.value;
  u.holes.value = texture;
  u.holeCount.value = list.length;
  if (previous !== EMPTY_MASK) previous.dispose();
}

const EMPTY_MASK = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export function createProvenanceUniforms(): ProvenanceUniforms {
  return {
    worldToCamera: dyno.dynoMat3(new THREE.Matrix3()),
    tanHalf: dyno.dynoFloat(Math.tan(Math.PI / 6)),
    aspect: dyno.dynoFloat(4 / 3),
    dream: dyno.dynoFloat(1),
    reveal: dyno.dynoFloat(0),
    peopleMask: dyno.dynoSampler2D(EMPTY_MASK as THREE.Texture),
    peopleStrength: dyno.dynoFloat(0),
    peopleDepth: dyno.dynoFloat(0),
    peopleCapsule: dyno.dynoVec4(new THREE.Vector4(0, 0, 0, 0)),
    peopleHeight: dyno.dynoVec2(new THREE.Vector2(0, 0)),
    peopleFront: dyno.dynoFloat(0),
    peopleBack: dyno.dynoFloat(0),
    holes: dyno.dynoSampler2D(EMPTY_MASK as THREE.Texture),
    holeCount: dyno.dynoFloat(0),
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
        peopleMask: "sampler2D",
        peopleStrength: "float",
        peopleDepth: "float",
        peopleCapsule: "vec4",
        peopleHeight: "vec2",
        peopleFront: "float",
        peopleBack: "float",
        holes: "sampler2D",
        holeCount: "float",
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

          // Hide the splat's copy of a person where their photo layer stands (see peopleMask).
          if (${inputs.peopleStrength} > 0.001 && observed > 0.0) {
            // Soft-edged on purpose: hiding hard exposes a dark halo of the sparse splats behind
            // the model's figure, which reads worse than a faint trace of its outline.
            float m = texture(${inputs.peopleMask}, ndc * 0.5 + 0.5).a;
            vec4 cap = ${inputs.peopleCapsule};
            vec3 p = ${inputs.gsplat}.center;
            // Inside the figure's capsule (3D), or, before it's known, near the person's depth.
            float within = cap.w > 0.5
              ? (1.0 - smoothstep(cap.z * 0.85, cap.z, length(p.xz - cap.xy)))
                * step(${inputs.peopleHeight}.x, p.y) * step(p.y, ${inputs.peopleHeight}.y)
              : 1.0 - smoothstep(0.6, 1.2, abs(-c.z - ${inputs.peopleDepth}));
            float front = ${inputs.peopleFront};
            // With a model: the head and shoulders band is hidden whole behind the person's front
            // (the figure's head sits a few cm off, outside the silhouette: a second head).
            // Lower down, only the silhouette: the furniture around the person stays.
            float band = step(${inputs.peopleHeight}.y - 0.55, p.y);
            float hide = front > 0.0 && cap.w > 0.5 ? max(m, step(front, -c.z) * step(-c.z, ${inputs.peopleBack}) * band) : m;
            rgba.a *= 1.0 - ${inputs.peopleStrength} * hide * within * ahead;
          }

          // The world's copies of what we draw ourselves (see Hole).
          if (ahead > 0.0) {
            vec2 photo = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
            vec3 at = ${inputs.gsplat}.center;
            bool keep = false;
            for (int i = 0; i < ${MAX_HOLES}; i++) {
              if (float(i) >= ${inputs.holeCount}) break;
              vec4 box = texelFetch(${inputs.holes}, ivec2(0, i), 0);
              if (texelFetch(${inputs.holes}, ivec2(3, i), 0).a > 2.5
                  && photo.x > box.x && photo.x < box.z && photo.y > box.y && photo.y < box.w) keep = true;
            }
            for (int i = 0; i < ${MAX_HOLES}; i++) {
              if (float(i) >= ${inputs.holeCount}) break;
              vec4 box = texelFetch(${inputs.holes}, ivec2(0, i), 0);
              if (photo.x < box.x || photo.x > box.z || photo.y < box.y || photo.y > box.w) continue;
              vec4 c = texelFetch(${inputs.holes}, ivec2(1, i), 0);
              vec4 n = texelFetch(${inputs.holes}, ivec2(2, i), 0);
              vec4 color = texelFetch(${inputs.holes}, ivec2(3, i), 0);
              vec3 d = at - c.xyz;
              if (color.a > 2.5) {
                // A keep region: nothing to do here.
              } else if (color.a > 1.5) {
                if (keep) continue;
                float shade = dot(color.rgb - rgba.rgb, vec3(0.299, 0.587, 0.114));
                if (abs(dot(d, n.xyz)) < c.w && shade > 0.04) rgba.rgb = color.rgb;
              } else if (color.a > 0.5) {
                if (abs(dot(d, n.xyz)) < c.w) rgba.rgb = color.rgb;
              } else {
                // Along the original camera's ray to the object (it sits at the origin).
                float along = dot(d, normalize(c.xyz));
                if (length(d - along * normalize(c.xyz)) < c.w && along > -n.y && along < n.z && at.y > n.x) {
                  rgba.a = 0.0;
                }
              }
            }
          }

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
        peopleMask: u.peopleMask,
        peopleStrength: u.peopleStrength,
        peopleDepth: u.peopleDepth,
        peopleCapsule: u.peopleCapsule,
        peopleHeight: u.peopleHeight,
        peopleFront: u.peopleFront,
        peopleBack: u.peopleBack,
        holes: u.holes,
        holeCount: u.holeCount,
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
