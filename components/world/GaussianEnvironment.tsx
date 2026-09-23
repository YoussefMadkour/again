"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { type RefObject, useEffect, useRef } from "react";
import type { WorldFx } from "./fx";

interface Props {
  url: string;
  quaternion: [number, number, number, number];
  fx: RefObject<WorldFx>;
  onLoaded: () => void;
  onError: (error: unknown) => void;
}

/**
 * Spark objects are created imperatively and added to the R3F scene. Spark's
 * SplatMesh does its loading in the constructor, so the JSX `args` pattern would
 * recreate it on every re-render.
 */
export function GaussianEnvironment({ url, quaternion, fx, onLoaded, onError }: Props) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const meshRef = useRef<SplatMesh | null>(null);
  const callbacks = useRef({ onLoaded, onError });
  callbacks.current = { onLoaded, onError };

  const [qx, qy, qz, qw] = quaternion;

  useEffect(() => {
    let disposed = false;
    const spark = new SparkRenderer({ renderer: gl });
    scene.add(spark);

    const mesh = new SplatMesh({ url });
    mesh.quaternion.set(qx, qy, qz, qw);
    mesh.opacity = 0;
    scene.add(mesh);
    meshRef.current = mesh;

    mesh.initialized
      .then(() => {
        if (!disposed) callbacks.current.onLoaded();
      })
      .catch((error: unknown) => {
        if (!disposed) callbacks.current.onError(error);
      });

    return () => {
      disposed = true;
      meshRef.current = null;
      scene.remove(mesh);
      scene.remove(spark);
      mesh.dispose();
      spark.dispose?.();
    };
  }, [gl, scene, url, qx, qy, qz, qw]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const opacity = fx.current.worldOpacity;
    mesh.opacity = opacity;
    // Spark only finishes initializing meshes it is asked to draw, so stay visible until loaded.
    mesh.visible = !mesh.isInitialized || opacity > 0.001;
  });

  return null;
}
