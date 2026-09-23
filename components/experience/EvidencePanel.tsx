"use client";

import { motion } from "framer-motion";
import { useEffect } from "react";
import type { BoundingBox } from "@/lib/analysis/schema";

interface Props {
  photo: { url: string; aspect: number };
  object: { label: string; description: string; bbox: BoundingBox };
  onClose: () => void;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Where a reconstructed object came from: the photograph, with the object outlined. */
export function EvidencePanel({ photo, object, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  const [x0, y0, x1, y1] = object.bbox;
  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-7 bg-black/70 px-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      onClick={onClose}
      data-testid="evidence"
    >
      <motion.div
        className="relative"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.9, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -inset-[10px] bg-[#e9e5da] shadow-[0_30px_80px_rgba(0,0,0,0.6)]" />
        <div className="relative overflow-hidden">
          {/* biome-ignore lint/performance/noImgElement: the user's own photo, shown as-is */}
          <img
            src={photo.url}
            alt="The original photograph"
            className="relative block"
            style={{
              height: `min(60vh, calc(80vw / ${photo.aspect}))`,
              aspectRatio: String(photo.aspect),
            }}
          />
          {/* Everything but the object dims, so the eye goes where the evidence is. */}
          <motion.div
            className="pointer-events-none absolute border border-bone/90 shadow-[0_0_0_200vmax_rgba(0,0,0,0.45),0_0_24px_rgba(255,236,200,0.55)]"
            style={{
              left: `${x0 * 100}%`,
              top: `${y0 * 100}%`,
              width: `${(x1 - x0) * 100}%`,
              height: `${(y1 - y0) * 100}%`,
            }}
            initial={{ opacity: 0, scale: 1.15 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, delay: 0.35, ease: EASE }}
          />
        </div>
      </motion.div>
      <motion.div
        className="flex flex-col items-center gap-2 text-center"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.6 }}
      >
        <p className="font-mono text-[11px] lowercase tracking-[0.35em] text-bone/70">
          observed here
        </p>
        <p className="font-display text-2xl text-bone">{object.label}</p>
        <p className="max-w-md font-mono text-[10px] lowercase leading-relaxed tracking-[0.2em] text-bone/45">
          reconstructed in 3D from this part of the photograph
        </p>
      </motion.div>
    </motion.div>
  );
}
