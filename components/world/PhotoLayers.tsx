"use client";

import { useFrame } from "@react-three/fiber";
import type { SplatMesh } from "@sparkjsdev/spark";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BoundingBox } from "@/lib/analysis/schema";
import type { OriginalCamera } from "@/lib/demo/memory";
import { fitFigureCapsule } from "@/lib/world/figure";
import { type LayerQuad, layerQuad } from "@/lib/world/placement";
import type { WorldFx } from "./fx";
import type { Hole } from "./GaussianEnvironment";
import type { ProvenanceUniforms } from "./provenance";

export interface PhotoLayerInput {
  id: string;
  kind: "person" | "flat";
  /** The region of the photo the layer's image covers. */
  bbox: BoundingBox;
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
    return { canvas, texture, silhouette };
  }, [photoAspect]);
  const personStrength = useRef(new Map<string, number>());

  useEffect(() => {
    provenance.peopleMask.value = mask.texture;
    return () => {
      provenance.peopleStrength.value = 0;
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
    if (!ctx || !core) return;
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
    const capsule = fitFigureCapsule(
      splat,
      camera,
      photoAspect,
      (u, v) =>
        pixels[(Math.floor(v * (height - 1)) * width + Math.floor(u * (width - 1))) * 4 + 3] / 255,
      depth,
    );
    if (capsule) {
      provenance.peopleCapsule.value.set(capsule.x, capsule.z, capsule.radius, 1);
      provenance.peopleHeight.value.set(capsule.yMin, capsule.yMax);
      if (process.env.NODE_ENV === "development") console.info("[again] figure capsule", capsule);
    }
  };

  return (
    <>
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
          onStrength={(s) => personStrength.current.set(layer.id, s)}
        />
      ))}
    </>
  );
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
  onStrength,
}: {
  layer: PhotoLayerInput;
  splat: SplatMesh;
  camera: OriginalCamera;
  photoAspect: number;
  fx: RefObject<WorldFx>;
  dream: RefObject<number>;
  onHole: (hole: Hole) => void;
  onPerson: (image: CanvasImageSource, box: BoundingBox, depth: number) => void;
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

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );

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
      // Flat things: erase the splat's blurry copy under the layer, with a thin slab on the
      // wall. (Not people: the splat around them is the room, and must stay.)
      if (q && !person) {
        const [tl, tr, , bl] = q.corners;
        holeRef.current({
          id: layer.id,
          center: q.center.clone(),
          size: new THREE.Vector3(tl.distanceTo(tr) * 0.5, tl.distanceTo(bl) * 0.5, 0.03),
          quaternion: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            q.normal,
          ),
        });
      }
    });
    return () => {
      cancelled = true;
      material.map?.dispose();
    };
  }, [layer, material, splat, camera, photoAspect]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  const origin = useMemo(() => new THREE.Vector3(...camera.position), [camera]);
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
    material.opacity = w * memory * fx.current.worldOpacity * (1 - fx.current.photoOpacity);
    if (layer.kind === "person") onStrength(material.opacity);
    if (mesh.current) mesh.current.visible = material.opacity > 0.002;
  });

  if (!geometry) return null;
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      // After the splat, under hero meshes' depth and the photo plane (10).
      renderOrder={5}
      name={`layer-${layer.id}`}
    />
  );
}
