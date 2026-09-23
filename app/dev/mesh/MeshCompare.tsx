"use client";

import { Bounds, Center, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useState } from "react";
import type * as THREE from "three";
import { fixGeneratedMaterial, roomEnvironment } from "@/lib/world/materials";

function Model({ url, angle }: { url: string; angle: number }) {
  const { scene } = useGLTF(url);
  const gl = useThree((s) => s.gl);
  // Same material handling as the app's hero objects.
  useMemo(() => {
    const env = roomEnvironment(gl);
    scene.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of [mesh.material].flat()) {
        fixGeneratedMaterial(m);
        (m as THREE.MeshStandardMaterial).envMap = env;
      }
    });
  }, [scene, gl]);
  return (
    <Bounds fit clip observe margin={1.15}>
      <Center rotation={[0, angle, 0]}>
        <primitive object={scene} />
      </Center>
    </Bounds>
  );
}

export function MeshCompare() {
  const [{ files, angle }] = useState(() => {
    const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    return {
      files: (q.get("files") ?? "").split(",").filter(Boolean),
      angle: Number(q.get("angle") ?? 0),
    };
  });
  return (
    <div style={{ display: "flex", gap: 8, background: "#1a1a1a", height: "100vh" }}>
      {files.map((f) => (
        <div key={f} style={{ flex: 1, position: "relative" }}>
          <Canvas camera={{ position: [0, 0.4, 3], fov: 35 }} data-testid="mesh">
            <color attach="background" args={["#d8d4cc"]} />
            <ambientLight intensity={1.2} />
            <directionalLight position={[2, 3, 2]} intensity={2} />
            <directionalLight position={[-2, 1, -1]} intensity={0.6} />
            <Suspense fallback={null}>
              <Model url={`/api/files/${f}`} angle={angle} />
            </Suspense>
            {/* Drag to orbit, scroll to zoom. */}
            <OrbitControls makeDefault enablePan={false} />
          </Canvas>
          <p
            style={{ position: "absolute", top: 8, left: 8, font: "12px monospace", color: "#222" }}
          >
            {f}
          </p>
        </div>
      ))}
    </div>
  );
}
