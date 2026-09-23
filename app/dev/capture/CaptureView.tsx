"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { type Memory, PAINTED_MEMORY } from "@/lib/demo/memory";
import type { CardRect } from "@/lib/world/entry";

const MemoryWorld = dynamic(() => import("@/components/world/MemoryWorld"), { ssr: false });

const parse = (v: string | null) =>
  v?.split(",").map(Number) as [number, number, number] | undefined;

export function CaptureView() {
  const [loaded, setLoaded] = useState(false);
  const card = useRef<CardRect | null>(null);
  const [memory] = useState<Memory>(() => {
    const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const cam = PAINTED_MEMORY.originalCamera;
    return {
      ...PAINTED_MEMORY,
      splatUrl: q.get("splat") ?? PAINTED_MEMORY.splatUrl,
      originalCamera: {
        position: parse(q.get("pos")) ?? cam.position,
        rotation: parse(q.get("rot")) ?? cam.rotation,
        fov: Number(q.get("fov") ?? cam.fov),
      },
    };
  });

  const [size] = useState(() => {
    const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    return { width: Number(q.get("w") ?? 1600), height: Number(q.get("h") ?? 1200) };
  });

  return (
    <div style={{ ...size, background: "#000" }} data-loaded={loaded}>
      <MemoryWorld
        memory={memory}
        mode="capture"
        card={card}
        returnSignal={0}
        muted
        onSelectObject={() => {}}
        dream={1}
        revealing={false}
        frozen
        onBeyond={() => {}}
        seenObjects={new Set()}
        onLoaded={() => setTimeout(() => setLoaded(true), 2500)}
        onError={(e) => console.error("capture: splat failed", e)}
        onEntered={() => {}}
      />
    </div>
  );
}
