"use client";

import { motion } from "framer-motion";
import { useEffect } from "react";

const LABEL = "font-mono text-[10px] uppercase tracking-[0.4em]";

/** MEMORY ━━━━●━━━━ DREAM. 0 favours what the photograph supports; 1 shows the whole world. */
export function MemoryDreamSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-4" data-testid="memory-dream">
      <button
        type="button"
        onClick={() => onChange(0)}
        className={`${LABEL} transition-colors duration-500 ${value < 0.5 ? "text-bone" : "text-bone/40"} hover:text-bone`}
      >
        Memory
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Memory to dream"
        className="memory-dream w-[min(18rem,40vw)]"
      />
      <button
        type="button"
        onClick={() => onChange(1)}
        className={`${LABEL} transition-colors duration-500 ${value >= 0.5 ? "text-bone" : "text-bone/40"} hover:text-bone`}
      >
        Dream
      </button>
    </div>
  );
}

const KINDS = [
  { name: "observed", note: "in the photograph", color: "#f3dcb4" },
  { name: "inferred", note: "extended from it", color: "#a99a86" },
  { name: "imagined", note: "beyond it", color: "#7f93b8" },
];

/** Shown while SPACE is held. */
export function ProvenanceLegend() {
  return (
    <motion.div
      className="pointer-events-none absolute top-[9vh] left-1/2 z-20 flex -translate-x-1/2 gap-10"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      data-testid="provenance-legend"
    >
      {KINDS.map((k) => (
        <div key={k.name} className="flex flex-col items-center gap-2">
          <span
            className="h-px w-10"
            style={{ background: k.color, boxShadow: `0 0 8px ${k.color}` }}
          />
          <span className={`${LABEL} text-bone/85`}>{k.name}</span>
          <span className="font-mono text-[9px] lowercase tracking-[0.25em] text-bone/40">
            {k.note}
          </span>
        </div>
      ))}
    </motion.div>
  );
}

/** The first time you turn well past what the photograph saw. */
export function BeyondOverlay({
  onContinue,
  onReturn,
}: {
  onContinue: () => void;
  onReturn: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter") onContinue();
      if (e.code === "Escape") {
        e.stopPropagation();
        onReturn();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onContinue, onReturn]);

  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-10 bg-black/55 px-6 text-center backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.8 } }}
      transition={{ duration: 1.4 }}
      data-testid="beyond"
    >
      <motion.div
        className="flex max-w-xl flex-col gap-5"
        initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 1.6, delay: 0.3 }}
      >
        <p className="font-display text-[clamp(1.6rem,3.2vw,2.4rem)] leading-tight text-bone">
          You are leaving the photographed memory.
        </p>
        <p className="font-mono text-[11px] lowercase tracking-[0.3em] text-bone/60">
          beyond this point, AGAIN. is imagining.
        </p>
      </motion.div>
      <motion.div
        className="flex flex-col items-center gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 1.2 }}
      >
        <button
          type="button"
          onClick={onContinue}
          // biome-ignore lint/a11y/noAutofocus: this moment asks for a choice
          autoFocus
          className="border border-bone/30 px-8 py-3 font-mono text-[11px] uppercase tracking-[0.4em] text-bone transition-colors duration-500 hover:border-bone/80 hover:bg-bone/5 focus-visible:border-bone focus-visible:outline-none"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={onReturn}
          className="font-mono text-[10px] lowercase tracking-[0.3em] text-bone/45 transition-colors hover:text-bone"
        >
          return to memory
        </button>
      </motion.div>
    </motion.div>
  );
}
