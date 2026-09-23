"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { type RefObject, useEffect, useRef } from "react";
import type { WorldFx } from "./fx";

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
}

const UPGRADE_FADE_S = 1.2;

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
}: Props) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const base = useRef<SplatMesh | null>(null);
  const upgrade = useRef<{ mesh: SplatMesh; blend: number; ready: boolean } | null>(null);
  const baseLoaded = useRef(false);
  const callbacks = useRef({ onLoaded, onError });
  callbacks.current = { onLoaded, onError };

  const [qx, qy, qz, qw] = quaternion;

  useEffect(() => {
    let disposed = false;
    const spark = new SparkRenderer({ renderer: gl });
    scene.add(spark);

    const mesh = createMesh(url, [qx, qy, qz, qw], scale);
    scene.add(mesh);
    base.current = mesh;
    baseLoaded.current = false;

    mesh.initialized
      .then(() => {
        if (disposed) return;
        baseLoaded.current = true;
        callbacks.current.onLoaded();
      })
      .catch((error: unknown) => {
        if (!disposed) callbacks.current.onError(error);
      });

    return () => {
      disposed = true;
      base.current = null;
      scene.remove(mesh);
      mesh.dispose();
      const up = upgrade.current;
      if (up) {
        scene.remove(up.mesh);
        up.mesh.dispose();
        upgrade.current = null;
      }
      scene.remove(spark);
      spark.dispose?.();
    };
  }, [gl, scene, url, qx, qy, qz, qw, scale]);

  useFrame((_, dt) => {
    const world = fx.current.worldOpacity;

    // Start the upgrade once the base is in and nothing cinematic is happening.
    if (upgradeUrl && !upgrade.current && baseLoaded.current && !holdUpgrade) {
      const mesh = createMesh(upgradeUrl, [qx, qy, qz, qw], scale);
      const entry = { mesh, blend: 0, ready: false };
      upgrade.current = entry;
      scene.add(mesh);
      mesh.initialized
        .then(() => {
          entry.ready = true;
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

function createMesh(url: string, [x, y, z, w]: [number, number, number, number], scale: number) {
  const mesh = new SplatMesh({ url });
  mesh.quaternion.set(x, y, z, w);
  mesh.scale.setScalar(scale);
  mesh.opacity = 0;
  return mesh;
}
