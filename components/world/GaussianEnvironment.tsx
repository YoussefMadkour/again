"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { type RefObject, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { WorldFx } from "./fx";
import { type Hole, type ProvenanceUniforms, provenanceModifier, setHoles } from "./provenance";

export type { Hole };

interface Props {
  url: string;
  /** A sharper splat of the same world, swapped in once it has loaded. */
  upgradeUrl?: string;
  /** Hold off starting the upgrade (its first upload can hitch a frame). */
  holdUpgrade: boolean;
  quaternion: [number, number, number, number];
  scale: number;
  fx: RefObject<WorldFx>;
  onLoaded: () => void;
  onError: (error: unknown) => void;
  /** The loaded base splat, for raycasting (placing objects and sounds). */
  onMesh?: (mesh: SplatMesh) => void;
  /** The world's own copies of things we draw ourselves (hero meshes, photo layers). */
  holes?: Hole[];
  /** Per-splat provenance (observed / inferred / imagined). */
  provenance?: ProvenanceUniforms;
}

const UPGRADE_FADE_S = 1.2;
const DISPOSE_DELAY_MS = 1500;

/**
 * Spark objects are created imperatively and added to the R3F scene. Spark's
 * SplatMesh does its loading in the constructor, so the JSX `args` pattern would
 * recreate it on every re-render.
 *
 * The lighter splat loads first so the memory is ready quickly; the full-resolution one
 * follows in the background and fades in over it. If it fails, the light one stays.
 */
export function GaussianEnvironment({
  url,
  upgradeUrl,
  holdUpgrade,
  quaternion,
  scale,
  fx,
  onLoaded,
  onError,
  onMesh,
  holes = [],
  provenance,
}: Props) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const base = useRef<SplatMesh | null>(null);
  const upgrade = useRef<{ mesh: SplatMesh; blend: number; ready: boolean } | null>(null);
  const baseLoaded = useRef(false);
  const [upgradeReady, setUpgradeReady] = useState(false);
  const callbacks = useRef({ onLoaded, onError, onMesh });
  callbacks.current = { onLoaded, onError, onMesh };

  const [qx, qy, qz, qw] = quaternion;

  useEffect(() => {
    let disposed = false;
    const spark = new SparkRenderer({ renderer: gl });
    scene.add(spark);

    const mesh = createMesh(url, [qx, qy, qz, qw], scale, provenance);
    scene.add(mesh);
    base.current = mesh;
    baseLoaded.current = false;

    mesh.initialized
      .then(() => {
        if (disposed) return;
        baseLoaded.current = true;
        callbacks.current.onLoaded();
        void whenRaycastable(mesh, () => disposed).then((ok) => {
          if (ok && !disposed) callbacks.current.onMesh?.(mesh);
        });
      })
      .catch((error: unknown) => {
        if (!disposed) callbacks.current.onError(error);
      });

    return () => {
      disposed = true;
      base.current = null;
      const up = upgrade.current;
      upgrade.current = null;
      scene.remove(mesh);
      if (up) scene.remove(up.mesh);
      scene.remove(spark);
      // Out of the scene now, disposed in a moment: Spark sorts splats with asynchronous GPU
      // readbacks, and one still in flight throws ("No target") if its buffers are gone.
      setTimeout(() => {
        mesh.dispose();
        up?.mesh.dispose();
        spark.dispose?.();
      }, DISPOSE_DELAY_MS);
    };
  }, [gl, scene, url, qx, qy, qz, qw, scale, provenance]);

  // Remove the world's copies where hero meshes and photo layers stand (see Hole).
  const holeKey = holes.map((h) => h.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: holes are keyed by id
  useEffect(() => {
    if (!provenance) return;
    setHoles(provenance, holes);
    base.current?.updateVersion();
    upgrade.current?.mesh.updateVersion();
  }, [holeKey, upgradeReady, provenance]);

  // Spark caches each splat's modified values: nudge it when the provenance uniforms move.
  const lastProvenance = useRef({ dream: -1, reveal: -1, people: -1 });

  useFrame((_, dt) => {
    const world = fx.current.worldOpacity;
    if (provenance) {
      const last = lastProvenance.current;
      const dream = provenance.dream.value;
      const reveal = provenance.reveal.value;
      // Strength, and where the hiding volume is (it's refit when a person's model is placed).
      const cap = provenance.peopleCapsule.value;
      const people =
        provenance.peopleStrength.value +
        (cap.x * 3.1 +
          cap.y * 5.3 +
          cap.z * 7.7 +
          provenance.peopleFront.value * 11.9 +
          provenance.peopleBack.value * 2.3) *
          10;
      if (
        Math.abs(dream - last.dream) > 1e-3 ||
        Math.abs(reveal - last.reveal) > 1e-3 ||
        Math.abs(people - last.people) > 1e-3
      ) {
        last.dream = dream;
        last.reveal = reveal;
        last.people = people;
        base.current?.updateVersion();
        upgrade.current?.mesh.updateVersion();
      }
    }

    // Start the upgrade once the base is in and nothing cinematic is happening.
    if (upgradeUrl && !upgrade.current && baseLoaded.current && !holdUpgrade) {
      const mesh = createMesh(upgradeUrl, [qx, qy, qz, qw], scale, provenance);
      const entry = { mesh, blend: 0, ready: false };
      upgrade.current = entry;
      scene.add(mesh);
      mesh.initialized
        .then(() => {
          entry.ready = true;
          setUpgradeReady(true);
          console.info("[again] full-resolution world loaded");
        })
        .catch((error: unknown) => {
          console.warn("[again] full-resolution splat failed, keeping the lighter one", error);
          scene.remove(mesh);
          mesh.dispose();
        });
    }

    const up = upgrade.current;
    if (up?.ready) up.blend = Math.min(1, up.blend + dt / UPGRADE_FADE_S);

    const mesh = base.current;
    if (mesh) {
      // Hold the base at full strength under the fade, then retire it.
      const retired = up?.ready && up.blend >= 1;
      mesh.opacity = world;
      // Spark only finishes initializing meshes it is asked to draw, so stay visible until loaded.
      mesh.visible = !retired && (!mesh.isInitialized || world > 0.001);
    }
    if (up) {
      up.mesh.opacity = up.ready ? world * up.blend : 0;
      up.mesh.visible = !up.ready || world > 0.001;
    }
  });

  return null;
}

function createMesh(
  url: string,
  [x, y, z, w]: [number, number, number, number],
  scale: number,
  provenance?: ProvenanceUniforms,
) {
  const mesh = new SplatMesh({
    url,
    worldModifier: provenance ? provenanceModifier(provenance) : undefined,
  });
  mesh.quaternion.set(x, y, z, w);
  mesh.scale.setScalar(scale);
  mesh.opacity = 0;
  return mesh;
}

/**
 * Spark's raycaster runs in a WebAssembly module that can finish initializing a moment after
 * the splat reports loaded. Probe until a ray straight ahead hits something (or give up).
 */
async function whenRaycastable(mesh: SplatMesh, cancelled: () => boolean) {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  for (let i = 0; i < 40 && !cancelled(); i++) {
    mesh.updateMatrixWorld(true);
    if (raycaster.intersectObject(mesh, false).length > 0) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
