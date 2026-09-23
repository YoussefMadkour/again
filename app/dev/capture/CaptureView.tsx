"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { DEMO_MEMORY, type Memory } from "@/lib/demo/memory";
import type { CardRect } from "@/lib/world/entry";

const MemoryWorld = dynamic(() => import("@/components/world/MemoryWorld"), { ssr: false });

const parse = (v: string | null) =>
  v?.split(",").map(Number) as [number, number, number] | undefined;

export function CaptureView() {
  const [loaded, setLoaded] = useState(false);
  const card = useRef<CardRect | null>(null);
  const [memory] = useState<Memory>(() => {
    const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const cam = DEMO_MEMORY.originalCamera;
    return {
      ...DEMO_MEMORY,
      originalCamera: {
        position: parse(q.get("pos")) ?? cam.position,
        rotation: parse(q.get("rot")) ?? cam.rotation,
        fov: Number(q.get("fov") ?? cam.fov),
      },
    };
  });

  return (
    <div style={{ width: 1600, height: 1200, background: "#000" }} data-loaded={loaded}>
      <MemoryWorld
        memory={memory}
        mode="capture"
        card={card}
        returnSignal={0}
        onLoaded={() => setTimeout(() => setLoaded(true), 2500)}
        onError={(e) => console.error("capture: splat failed", e)}
        onEntered={() => {}}
      />
    </div>
  );
}
