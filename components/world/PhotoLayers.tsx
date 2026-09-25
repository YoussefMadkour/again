"use client";

import { useFrame } from "@react-three/fiber";
import type { SplatMesh } from "@sparkjsdev/spark";
import { type RefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BoundingBox } from "@/lib/analysis/schema";
import type { OriginalCamera } from "@/lib/demo/memory";
import { fitFigureCapsule } from "@/lib/world/figure";
import { growBox, shadowHole, wallHole } from "@/lib/world/holes";
import { type LayerQuad, layerQuad, rayThroughPhoto } from "@/lib/world/placement";
import { BodyLayer, type BodyModel } from "./BodyLayer";
import type { WorldFx } from "./fx";
import type { Hole } from "./GaussianEnvironment";
import type { ProvenanceUniforms } from "./provenance";

export interface PhotoLayerInput {
  id: string;
  kind: "person" | "flat";
  /** The region of the photo the layer's image covers. */
  bbox: BoundingBox;
  /** What it is, in the vision model's words ("held framed portrait"). */
  label?: string;
  /** The thing itself, inside that region (the image is padded). */
  frame?: BoundingBox;
  /** A person's 3D body (SAM 3D Body), to wear their photo at wider angles. */
  body?: BodyModel;
  url: string;
}

interface Props {
  layers: PhotoLayerInput[];
  splat: SplatMesh;
  camera: OriginalCamera;
  photoAspect: number;
  fx: RefObject<WorldFx>;
  /** 0 = MEMORY (the photograph's pixels at full strength) … 1 = DREAM (softer). */
  dream: RefObject<number>;
  /** Regions of the splat to erase: the blurry copies of flat things the layers replace. */
  onHoles: (holes: Hole[]) => void;
  /** Gets the people mask, and how strongly person layers show, each frame. */
  provenance: ProvenanceUniforms;
  /** Draw the flat layers (portraits, frames). Off shows the world's own copies of them. */
  showFlat?: boolean;
}

const MASK_WIDTH = 512;

const COS = (deg: number) => Math.cos((deg * Math.PI) / 180);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The photograph's own pixels where the world model can't rebuild them: faces, portraits,
 * framed photos. Drawn over the splat (they *are* the photo), under hero meshes and the
 * photo plane.
 *
 *   flat     on the wall's plane, so right from any angle; fades only at grazing angles
 *   person   upright at their depth; full near where the photo was taken, fading as you walk
 *            or look away, before the flatness shows
 */
export function PhotoLayers({
  layers,
  splat,
  camera,
  photoAspect,
  fx,
  dream,
  onHoles,
  provenance,
  showFlat = true,
}: Props) {
  const holes = useRef(new Map<string, Hole>());
  const report = useRef(onHoles);
  report.current = onHoles;

  // All person cutouts painted into one photo-space alpha mask, for the splat to hide behind.
  const mask = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = MASK_WIDTH;
    canvas.height = Math.round(MASK_WIDTH / photoAspect);
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = true;
    // The same, undilated: which splats are the person's core.
    const silhouette = document.createElement("canvas");
    silhouette.width = canvas.width;
    silhouette.height = canvas.height;
    // Grown a little, for flat layers to cut people out of: a frame on the wall behind someone
    // carries their pixels in its cutout, and pasted flat on the wall those read as a ghost.
    const trim = document.createElement("canvas");
    trim.width = canvas.width;
    trim.height = canvas.height;
    const trimTexture = new THREE.CanvasTexture(trim);
    trimTexture.flipY = true;
    return { canvas, texture, silhouette, trim, trimTexture };
  }, [photoAspect]);
  const personStrength = useRef(new Map<string, number>());
  // The splat's figure core, kept so the capsule can be refit once a person's model is placed.
  const figure = useRef<{ silhouette: (u: number, v: number) => number; depth: number } | null>(
    null,
  );

  useEffect(() => {
    provenance.peopleMask.value = mask.texture;
    return () => {
      provenance.peopleStrength.value = 0;
      mask.trimTexture.dispose();
      provenance.peopleFront.value = 0;
      provenance.peopleBack.value = 0;
      mask.texture.dispose();
    };
  }, [mask, provenance]);

  useFrame(() => {
    let strength = 0;
    for (const s of personStrength.current.values()) strength = Math.max(strength, s);
    provenance.peopleStrength.value = strength;
  });

  const addPerson = (image: CanvasImageSource, [x0, y0, x1, y1]: BoundingBox, depth: number) => {
    const ctx = mask.canvas.getContext("2d");
    const core = mask.silhouette.getContext("2d", { willReadFrequently: true });
    const trim = mask.trim.getContext("2d");
    if (!ctx || !core || !trim) return;
    const { width, height } = mask.canvas;
    const at = (dx: number, dy: number, target: CanvasRenderingContext2D) =>
      target.drawImage(
        image,
        x0 * width + dx,
        y0 * height + dy,
        (x1 - x0) * width,
        (y1 - y0) * height,
      );
    at(0, 0, core);
    const edge = Math.max(1, Math.round(width * 0.006));
    for (const [dx, dy] of [
      [0, 0],
      [edge, 0],
      [-edge, 0],
      [0, edge],
      [0, -edge],
    ])
      at(dx, dy, trim);
    mask.trimTexture.needsUpdate = true;
    // Grown generously: the capsule below keeps the hiding off the wall behind the person.
    const grow = Math.round(width * 0.045);
    const step = Math.max(1, Math.round(grow / 3));
    for (let dy = -grow; dy <= grow; dy += step) {
      for (let dx = -grow; dx <= grow; dx += step) at(dx, dy, ctx);
    }
    mask.texture.needsUpdate = true;
    provenance.peopleDepth.value = depth;

    // Find the world model's own figure of this person, in 3D.
    const pixels = core.getImageData(0, 0, width, height).data;
    figure.current = {
      silhouette: (u, v) =>
        pixels[(Math.floor(v * (height - 1)) * width + Math.floor(u * (width - 1))) * 4 + 3] / 255,
      depth,
    };
    fitCapsule();
  };

  /** The hiding volume: around the splat's figure, and around the person's model when placed
   * (the two sit a few centimetres apart; hiding only one leaves a second head). */
  const fitCapsule = (model?: Float32Array) => {
    if (!figure.current) return null;
    const capsule = fitFigureCapsule(
      splat,
      camera,
      photoAspect,
      figure.current.silhouette,
      figure.current.depth,
      model,
    );
    if (!capsule) return null;
    provenance.peopleCapsule.value.set(capsule.x, capsule.z, capsule.radius, 1);
    provenance.peopleHeight.value.set(capsule.yMin, capsule.yMax);
    if (process.env.NODE_ENV === "development") console.info("[again] figure capsule", capsule);
    return capsule;
  };

  // The room's depth from the original camera, without the person: what stands in front of them.
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  // Where things the person holds are, in the photo: the model's copies of them are clipped.
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());

  return (
    <>
      {backdrop && (
        <WallBackdrop backdrop={backdrop} camera={camera} aspect={photoAspect} fx={fx} />
      )}
      {layers.map((layer) => (
        <PhotoLayer
          key={layer.id}
          layer={layer}
          splat={splat}
          camera={camera}
          photoAspect={photoAspect}
          fx={fx}
          dream={dream}
          onHole={(hole) => {
            holes.current.set(layer.id, hole);
            report.current([...holes.current.values()]);
          }}
          onPerson={addPerson}
          people={mask.trimTexture}
          onModel={(points) => {
            const capsule = fitCapsule(points);
            const [front, back] = depthRange(points, camera);
            provenance.peopleFront.value = front;
            // Through the world's figure too: it can stand a little behind the person as shown.
            provenance.peopleBack.value = Math.max(back, (capsule?.far ?? 0) + 0.05);
            // Her shadow on the wall behind her (a flash photo's): at the viewpoint it sits
            // behind her, from the side it reads as a second person. Painted out.
            const shadow = shadowHole(
              splat,
              camera,
              photoAspect,
              `${layer.id}-shadow`,
              layer.frame ?? layer.bbox,
              provenance.peopleBack.value,
            );
            // Something she's holding (the vision model says so, and it's at her hand): her model
            // holds its own, with her hand; the flat photo layer of it (on the wall) is dropped.
            const heldLayers = layers.filter(
              (l) =>
                l.kind === "flat" &&
                // The vision model names it in its id or label ("held-framed-portrait").
                HELD.test(`${l.id.replace(/-/g, " ")} ${l.label ?? ""}`) &&
                silhouetteCover(mask.silhouette, l.frame ?? l.bbox) > 0.02,
            );
            setHeld(new Set(heldLayers.map((l) => l.id)));
            const holding = heldLayers.map((l) => growBox(l.frame ?? l.bbox, 0.04, 0.003));
            // And the world's copy of it, in her hand (the layer's own hole is on the wall).
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
              new THREE.Quaternion().setFromEuler(new THREE.Euler(...camera.rotation, "YXZ")),
            );
            const mid = (front + back) / 2;
            holding.forEach((box, i) => {
              const ray = rayThroughPhoto(
                camera,
                photoAspect,
                (box[0] + box[2]) / 2,
                (box[1] + box[3]) / 2,
              );
              const center = ray.at(
                mid / Math.max(0.2, ray.direction.dot(forward)),
                new THREE.Vector3(),
              );
              const w = rayThroughPhoto(camera, photoAspect, box[0], box[1]).at(
                mid,
                new THREE.Vector3(),
              );
              const h = rayThroughPhoto(camera, photoAspect, box[2], box[3]).at(
                mid,
                new THREE.Vector3(),
              );
              const id = `${layer.id}-held-${i}`;
              holes.current.set(id, {
                id,
                kind: "object",
                box: box as [number, number, number, number],
                center,
                radius: w.distanceTo(h) * 0.6,
                front: center.distanceTo(new THREE.Vector3(...camera.position)) - front + 0.05,
                back: back - mid + 0.05,
                floor: Number.NEGATIVE_INFINITY,
              });
            });
            report.current([...holes.current.values()]);
            if (shadow) {
              // Pictures on the wall near her are darker than the wall too: left alone.
              for (const l of layers) {
                if (l.kind !== "flat" || heldLayers.includes(l)) continue;
                const id = `${l.id}-keep`;
                holes.current.set(id, {
                  id,
                  kind: "keep",
                  box: growBox(l.frame ?? l.bbox, 0.1, 0.004),
                  center: new THREE.Vector3(),
                });
              }
              holes.current.set(shadow.id, shadow);
              report.current([...holes.current.values()]);
              if (shadow.kind === "wall") {
                setBackdrop({
                  center: shadow.center,
                  normal: shadow.normal,
                  color: shadow.color,
                  // Head to waist: lower down, furniture can stand behind the wall's plane.
                  box: upperHalf(growBox(layer.frame ?? layer.bbox, 0.15, 0.005)),
                });
              }
            }
          }}
          onStrength={(s) => personStrength.current.set(layer.id, s)}
          hidden={(!showFlat && layer.kind === "flat") || held.has(layer.id)}
        />
      ))}
    </>
  );
}

/** How much of a photo box the people's silhouettes cover, 0..1. */
function silhouetteCover(silhouette: HTMLCanvasElement, [x0, y0, x1, y1]: readonly number[]) {
  const ctx = silhouette.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  const { width, height } = silhouette;
  const left = Math.floor(x0 * width);
  const top = Math.floor(y0 * height);
  const w = Math.max(1, Math.ceil((x1 - x0) * width));
  const h = Math.max(1, Math.ceil((y1 - y0) * height));
  const { data } = ctx.getImageData(left, top, w, h);
  let covered = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) covered++;
  return covered / (w * h);
}

const HELD = /\b(held|holding|in (her|his|their) hands?)\b/i;

const upperHalf = ([x0, y0, x1, y1]: readonly number[]) =>
  [x0, y0, x1, y0 + (y1 - y0) * 0.5] as const;

interface Backdrop {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  color: THREE.Color;
  box: readonly [number, number, number, number];
}

/**
 * The wall behind a person, as a plain surface just behind the world's own wall. The world
 * model's wall is thin where it put its figure of them; with the figure hidden, you'd see
 * through it (a dark shape like a second person). The world's wall draws over this, so it
 * only shows through those gaps.
 */
function WallBackdrop({
  backdrop,
  camera,
  aspect,
  fx,
}: {
  backdrop: Backdrop;
  camera: OriginalCamera;
  aspect: number;
  fx: RefObject<WorldFx>;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      backdrop.normal,
      backdrop.center.clone().addScaledVector(backdrop.normal, -0.06),
    );
    const [x0, y0, x1, y1] = backdrop.box;
    const corners = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([u, v]) =>
      rayThroughPhoto(camera, aspect, u, v).intersectPlane(plane, new THREE.Vector3()),
    );
    if (corners.some((c) => !c)) return null;
    const g = new THREE.BufferGeometry().setFromPoints(corners as THREE.Vector3[]);
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 3, 1, 1, 3, 2]);
    return g;
  }, [backdrop, camera, aspect]);
  // Under the splats (drawn first, not writing depth): it only shows where the world's wall is
  // thin, and fades out toward its edges so it never reads as a panel.
  const material = useMemo(() => {
    const { r, g, b } = backdrop.color;
    return new THREE.ShaderMaterial({
      uniforms: {
        // Splat colours are display values; three treats a material colour as linear.
        color: { value: new THREE.Color(r, g, b) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        varying vec2 vUv;
        void main() {
          float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          gl_FragColor = vec4(color, smoothstep(0.0, 0.3, edge));
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [backdrop]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    // Only once the world is fully in (the world fades in over the photo).
    if (mesh.current) mesh.current.visible = fx.current.worldOpacity > 0.98;
  });
  if (!geometry) return null;
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      renderOrder={-2}
      name="wall-backdrop"
    />
  );
}

/** The model's depth range along the original camera (2nd..98th percentile), with margins. */
function depthRange(points: Float32Array, camera: OriginalCamera): [number, number] {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...camera.rotation, "YXZ")),
  );
  const [ox, oy, oz] = camera.position;
  const depths: number[] = [];
  for (let i = 0; i < points.length; i += 3) {
    depths.push(
      (points[i] - ox) * forward.x +
        (points[i + 1] - oy) * forward.y +
        (points[i + 2] - oz) * forward.z,
    );
  }
  depths.sort((a, b) => a - b);
  const at = (p: number) => depths[Math.floor((depths.length - 1) * p)];
  return [Math.max(0.05, at(0.02) - 0.03), at(0.98) + 0.1];
}

/** Up to ~40 points (0..1 in the image) where the texture is opaque. */
function solidPoints(image: CanvasImageSource & { width: number; height: number }) {
  const n = 24;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0, n, n);
  const { data } = ctx.getImageData(0, 0, n, n);
  const points: [number, number][] = [];
  for (let y = 1; y < n; y += 3) {
    for (let x = 1; x < n; x += 3) {
      if (data[(y * n + x) * 4 + 3] > 220) points.push([(x + 0.5) / n, (y + 0.5) / n]);
    }
  }
  return points;
}

function PhotoLayer({
  layer,
  splat,
  camera,
  photoAspect,
  fx,
  dream,
  onHole,
  onPerson,
  people,
  onModel,
  onStrength,
  hidden,
}: {
  layer: PhotoLayerInput;
  splat: SplatMesh;
  camera: OriginalCamera;
  photoAspect: number;
  fx: RefObject<WorldFx>;
  dream: RefObject<number>;
  onHole: (hole: Hole) => void;
  onPerson: (image: CanvasImageSource, box: BoundingBox, depth: number) => void;
  /** Where people are in the photo (alpha), to cut out of flat layers. */
  people: THREE.Texture;
  onModel: (points: Float32Array) => void;
  /** Not drawn (photo layers off, or something the person's model holds itself). */
  hidden: boolean;
  onStrength: (strength: number) => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const [quad, setQuad] = useState<LayerQuad | null>(null);
  const holeRef = useRef(onHole);
  holeRef.current = onHole;
  const personRef = useRef(onPerson);
  personRef.current = onPerson;

  const geometry = useMemo(() => {
    if (!quad) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        quad.corners.flatMap((c) => [c.x, c.y, c.z]),
        3,
      ),
    );
    // top-left, top-right, bottom-right, bottom-left
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    g.setIndex([0, 3, 1, 1, 3, 2]);
    return g;
  }, [quad]);

  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    if (layer.kind === "flat") {
      // Nobody's pixels on the wall: people are carried by their own layer.
      const [x0, y0, x1, y1] = layer.bbox;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.people = { value: people };
        shader.uniforms.box = { value: new THREE.Vector4(x0, y0, x1, y1) };
        shader.fragmentShader = shader.fragmentShader
          .replace("void main() {", "uniform sampler2D people;\nuniform vec4 box;\nvoid main() {")
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            vec2 inPhoto = vec2(mix(box.x, box.z, vMapUv.x), mix(box.y, box.w, 1.0 - vMapUv.y));
            diffuseColor.a *= 1.0 - texture2D(people, vec2(inPhoto.x, 1.0 - inPhoto.y)).a;`,
          );
      };
    }
    return m;
  }, [layer.kind, layer.bbox, people]);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(layer.url, (texture) => {
      if (cancelled) return texture.dispose();
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      material.map = texture;
      material.needsUpdate = true;
      const person = layer.kind === "person";
      const q = layerQuad(
        splat,
        camera,
        photoAspect,
        layer.bbox,
        person ? "facing" : "wall",
        person ? solidPoints(texture.image as HTMLImageElement) : undefined,
      );
      setQuad(q);
      if (q && person) {
        // Depth along the original camera's view, as the splat shader measures it.
        const toCenter = q.center.clone().sub(new THREE.Vector3(...camera.position));
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...camera.rotation, "YXZ")),
        );
        personRef.current(texture.image as HTMLImageElement, layer.bbox, toCenter.dot(forward));
      }
      if (process.env.NODE_ENV === "development" && q) {
        const d = q.center.distanceTo(new THREE.Vector3(...camera.position));
        console.info(
          "[again] layer",
          layer.id,
          `${d.toFixed(2)}m`,
          "normal",
          q.normal
            .toArray()
            .map((v) => v.toFixed(2))
            .join(","),
        );
      }
      // Flat things: repaint the world's blurry copy as wall (not people: the splat around
      // them is the room, and must stay).
      if (q && !person) {
        holeRef.current(
          wallHole(
            splat,
            camera,
            photoAspect,
            layer.id,
            layer.frame ?? layer.bbox,
            q.center.clone(),
            q.normal.clone(),
          ),
        );
      }
    });
    return () => {
      cancelled = true;
      material.map?.dispose();
    };
  }, [layer, material, splat, camera, photoAspect]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  const origin = useMemo(() => new THREE.Vector3(...camera.position), [camera]);
  const forward = useMemo(
    () =>
      new THREE.Vector3(0, 0, -1).applyQuaternion(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...camera.rotation, "YXZ")),
      ),
    [camera],
  );
  const bodyOpacity = useRef(0);
  // The person's model when they have one (?body=0 compares without it).
  const withBody = Boolean(
    layer.body &&
      (typeof window === "undefined" ||
        new URLSearchParams(window.location.search).get("body") !== "0"),
  );
  const view = useMemo(() => new THREE.Vector3(), []);
  const fromOrigin = useMemo(
    () => (quad ? quad.center.clone().sub(origin).normalize() : new THREE.Vector3()),
    [quad, origin],
  );

  useFrame(({ camera: viewer }) => {
    if (!material.map || !quad) return;
    view.copy(quad.center).sub(viewer.position).normalize();
    let w: number;
    if (layer.kind === "person") {
      // Full strength around the viewpoint (entering ends ~0.45m in), gone a metre further:
      // half-visible, the photo and the blank splat figure read as a ghost.
      const nearViewpoint = 1 - smooth(0.6, 1.4, viewer.position.distanceTo(origin));
      const sameAngle = smooth(COS(34), COS(20), view.dot(fromOrigin));
      w = nearViewpoint * sameAngle;
    } else {
      // Flat on the wall: right from anywhere but edge-on.
      w = smooth(0.18, 0.42, -view.dot(quad.normal));
    }
    // Flat things soften toward DREAM. People don't do half measures (a half-visible photo over
    // the model's blank-faced figure reads as a ghost): full, handing over only near DREAM,
    // which means "the world as the model made it".
    const d = dream.current ?? 1;
    const memory = layer.kind === "person" ? 1 - smooth(0.85, 1, d) : 1 - 0.4 * d;
    const shown = memory * fx.current.worldOpacity * (1 - fx.current.photoOpacity);
    if (withBody) {
      // With a model: only the model (the flat cutout beside it, a few cm apart, reads as a
      // double). The world's own figure stays hidden throughout.
      material.opacity = 0;
      bodyOpacity.current = shown;
      onStrength(shown);
    } else {
      material.opacity = w * shown;
      if (layer.kind === "person") onStrength(material.opacity);
    }
    if (hidden) material.opacity = 0;
    if (mesh.current) mesh.current.visible = material.opacity > 0.002;
  });

  if (!geometry) return null;
  return (
    <>
      <mesh
        ref={mesh}
        geometry={geometry}
        material={material}
        // After the splat, under hero meshes' depth and the photo plane (10); over the body.
        renderOrder={6}
        name={`layer-${layer.id}`}
      />
      {withBody && layer.body && quad && material.map && (
        // Its own boundary: loading the mesh must never suspend the rest of the world.
        <Suspense fallback={null}>
          <BodyLayer
            body={layer.body}
            camera={camera}
            depth={quad.center.clone().sub(origin).dot(forward)}
            opacity={bodyOpacity}
            onPlaced={onModel}
          />
        </Suspense>
      )}
    </>
  );
}
