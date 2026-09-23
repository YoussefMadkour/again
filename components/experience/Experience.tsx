"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { DEMO_MEMORY } from "@/lib/demo/memory";
import { type ExperienceEvent, type ExperienceState, nextState } from "@/lib/experience/state";
import type { CardRect } from "@/lib/world/entry";

const MemoryWorld = dynamic(() => import("@/components/world/MemoryWorld"), { ssr: false });

const memory = DEMO_MEMORY;
const EASE = [0.22, 1, 0.36, 1] as const;

function reducer(state: ExperienceState, event: ExperienceEvent) {
  return nextState(state, event);
}

export function Experience() {
  // Milestone 1: the demo memory is already "generated", so we open on it.
  const [state, dispatch] = useReducer(reducer, "ready");
  const [worldLoaded, setWorldLoaded] = useState(false);
  const [returnSignal, setReturnSignal] = useState(0);
  const photoRef = useRef<HTMLImageElement>(null);
  const card = useRef<CardRect | null>(null);

  const measure = useCallback(() => {
    const el = photoRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.height === 0) return;
    card.current = {
      dx: r.left + r.width / 2 - window.innerWidth / 2,
      dy: r.top + r.height / 2 - window.innerHeight / 2,
      height: r.height,
      viewportHeight: window.innerHeight,
    };
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = photoRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const inWorld = state === "entering" || state === "exploring";
  const canEnter = state === "ready" && worldLoaded;

  const stepInside = useCallback(() => {
    if (!canEnter) return;
    measure();
    dispatch({ type: "STEP_INSIDE" });
  }, [canEnter, measure]);

  useEffect(() => {
    if (!canEnter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter") stepInside();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEnter, stepInside]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-bone" data-state={state}>
      {state !== "error" && (
        <div className="absolute inset-0 z-0">
          <MemoryWorld
            memory={memory}
            mode={state === "entering" || state === "exploring" ? state : "ready"}
            card={card}
            returnSignal={returnSignal}
            onLoaded={() => setWorldLoaded(true)}
            onError={() => dispatch({ type: "FAIL" })}
            onEntered={() => dispatch({ type: "ENTERED" })}
          />
        </div>
      )}

      {/* The memory view: title, photograph, invitation. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-4">
        <motion.header
          className="absolute top-[9vh] flex flex-col items-center gap-3 text-center"
          animate={{ opacity: inWorld ? 0 : 1, y: inWorld ? -8 : 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-none tracking-[0.02em]">
            AGAIN.
          </h1>
          <p className="font-mono text-[11px] lowercase tracking-[0.35em] text-bone/55">
            step inside a memory
          </p>
        </motion.header>

        <motion.div
          className="relative"
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: inWorld ? 0 : 1, scale: 1 }}
          transition={
            inWorld
              ? { duration: 0.35, delay: 0.15, ease: "linear" }
              : { duration: 1.6, ease: EASE }
          }
        >
          {/* Print border fades first so the bare image hands off to the canvas. */}
          <motion.div
            className="absolute -inset-[10px] bg-[#e9e5da] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
            animate={{ opacity: inWorld ? 0 : 1 }}
            transition={{ duration: 0.25 }}
          />
          {/* biome-ignore lint/performance/noImgElement: must be a plain img so its rect matches the 3D plane exactly */}
          <img
            ref={photoRef}
            src={memory.photoUrl}
            alt="The photograph this memory was made from"
            onLoad={measure}
            draggable={false}
            className="relative block select-none"
            style={{
              height: `min(50vh, calc(78vw / ${memory.photoAspect}))`,
              aspectRatio: String(memory.photoAspect),
            }}
          />
        </motion.div>

        <div className="absolute bottom-[10vh] flex h-24 flex-col items-center justify-end gap-5">
          <AnimatePresence mode="wait">
            {state === "ready" && !worldLoaded && (
              <motion.p
                key="loading"
                className="font-mono text-[11px] lowercase tracking-[0.35em] text-bone/50"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: [0.35, 0.8, 0.35],
                  transition: { duration: 2.4, repeat: Number.POSITIVE_INFINITY },
                }}
                exit={{ opacity: 0, transition: { duration: 0.4 } }}
              >
                remembering...
              </motion.p>
            )}
            {canEnter && (
              <motion.div
                key="ready"
                className="flex flex-col items-center gap-5"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.3 } }}
                transition={{ duration: 1, ease: EASE }}
              >
                <p className="font-mono text-[11px] lowercase tracking-[0.35em] text-bone/55">
                  memory ready
                </p>
                <button
                  type="button"
                  onClick={stepInside}
                  className="pointer-events-auto border border-bone/30 px-8 py-3 font-mono text-[12px] uppercase tracking-[0.4em] text-bone transition-colors duration-500 hover:border-bone/80 hover:bg-bone/5 focus-visible:border-bone focus-visible:outline-none"
                >
                  Step inside
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {state === "exploring" && <ExploreHud onReturn={() => setReturnSignal((n) => n + 1)} />}
      </AnimatePresence>

      {state === "error" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6">
          <p className="font-mono text-[11px] lowercase tracking-[0.35em] text-bone/60">
            this memory could not be opened
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="border border-bone/30 px-6 py-2 font-mono text-[11px] uppercase tracking-[0.35em] hover:border-bone/80"
          >
            try again
          </button>
        </div>
      )}

      <div className="grain pointer-events-none absolute z-30" />
      <div className="vignette pointer-events-none absolute inset-0 z-30" />
    </main>
  );
}

function ExploreHud({ onReturn }: { onReturn: () => void }) {
  const [hintVisible, setHintVisible] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setHintVisible(false), 7000);
    return () => clearTimeout(id);
  }, []);

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-20"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.2, delay: 0.3 }}
      data-testid="explore-hud"
    >
      <motion.p
        className="absolute bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] lowercase tracking-[0.3em] text-bone/45"
        animate={{ opacity: hintVisible ? 1 : 0 }}
        transition={{ duration: 1.5 }}
      >
        drag to look · wasd to move · esc to return
      </motion.p>
      <button
        type="button"
        onClick={onReturn}
        className="pointer-events-auto absolute right-6 bottom-6 font-mono text-[10px] lowercase tracking-[0.3em] text-bone/45 transition-colors hover:text-bone"
      >
        return to photo
      </button>
    </motion.div>
  );
}
