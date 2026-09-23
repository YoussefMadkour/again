"use client";

import { Canvas } from "@react-three/fiber";
import { type RefObject, Suspense, useRef } from "react";
import type { Memory } from "@/lib/demo/memory";
import type { CardRect } from "@/lib/world/entry";
import { CameraController, type WorldMode } from "./CameraController";
import { createWorldFx } from "./fx";
import { GaussianEnvironment } from "./GaussianEnvironment";
import { PhotoPlane } from "./PhotoPlane";

interface Props {
  memory: Memory;
  mode: WorldMode;
  card: RefObject<CardRect | null>;
  returnSignal: number;
  onLoaded: () => void;
  onError: (error: unknown) => void;
  onEntered: () => void;
}

export default function MemoryWorld({
  memory,
  mode,
  card,
  returnSignal,
  onLoaded,
  onError,
  onEntered,
}: Props) {
  const fx = useRef(createWorldFx());
  const capture = mode === "capture";

  return (
    <Canvas
      flat
      dpr={capture ? 1 : [1, 1.75]}
      gl={{ antialias: false, preserveDrawingBuffer: capture }}
      camera={{ fov: memory.originalCamera.fov, near: 0.01, far: 200 }}
      onCreated={({ gl }) => gl.setClearColor("#000000", 1)}
      style={{ touchAction: "none" }}
      data-testid="memory-world"
    >
      <GaussianEnvironment
        url={memory.splatUrl}
        quaternion={memory.splatQuaternion}
        scale={memory.splatScale}
        fx={fx}
        onLoaded={onLoaded}
        onError={onError}
      />
      {!capture && (
        <Suspense fallback={null}>
          <PhotoPlane
            url={memory.photoUrl}
            aspect={memory.photoAspect}
            camera={memory.originalCamera}
            fx={fx}
          />
        </Suspense>
      )}
      <CameraController
        mode={mode}
        original={memory.originalCamera}
        card={card}
        fx={fx}
        returnSignal={returnSignal}
        onEntered={onEntered}
      />
    </Canvas>
  );
}
