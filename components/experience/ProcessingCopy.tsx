"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

const READING = "reading memory...";
/** A world takes a few minutes; these cycle while it's made. */
const GENERATING = [
  "finding the room...",
  "reconstructing space...",
  "listening...",
  "looking beyond the frame...",
];
const LINE_MS = 6500;

export function ProcessingCopy({ phase }: { phase: "uploading" | "generating" }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (phase !== "generating") return;
    setIndex(0);
    const id = setInterval(() => setIndex((i) => (i + 1) % GENERATING.length), LINE_MS);
    return () => clearInterval(id);
  }, [phase]);

  const line = phase === "uploading" ? READING : GENERATING[index];

  return (
    <div className="relative h-4 w-80 text-center" aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.p
          key={line}
          className="absolute inset-0 font-mono text-[11px] lowercase tracking-[0.35em] text-bone/55"
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(4px)" }}
          transition={{ duration: 1.1 }}
        >
          {line}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
