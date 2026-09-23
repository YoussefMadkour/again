"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DEMO_MEMORY, type Memory } from "@/lib/demo/memory";
import {
  buildMemory,
  forgetPending,
  MemoryError,
  type PreparedPhoto,
  preparePhoto,
  recallPending,
  rememberPending,
  submitPhoto,
  waitForWorld,
} from "@/lib/experience/memory-client";
import { type ExperienceEvent, type ExperienceState, nextState } from "@/lib/experience/state";
import type { CardRect } from "@/lib/world/entry";
import { PhotoDrop } from "./PhotoDrop";
import { ProcessingCopy } from "./ProcessingCopy";

const MemoryWorld = dynamic(() => import("@/components/world/MemoryWorld"), { ssr: false });

const EASE = [0.22, 1, 0.36, 1] as const;
const LABEL = "font-mono text-[11px] lowercase tracking-[0.35em] text-bone/55";
const QUIET_BUTTON =
  "pointer-events-auto font-mono text-[10px] lowercase tracking-[0.3em] text-bone/40 transition-colors duration-500 hover:text-bone/90 focus-visible:text-bone focus-visible:outline-none";

function reducer(state: ExperienceState, event: ExperienceEvent) {
  return nextState(state, event);
}

interface Photo {
  url: string;
  aspect: number;
}

export function Experience() {
  const [state, dispatch] = useReducer(reducer, "idle");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [worldLoaded, setWorldLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [returnSignal, setReturnSignal] = useState(0);
  const card = useRef<CardRect | null>(null);
  const photoEl = useRef<HTMLImageElement | null>(null);
  const job = useRef<AbortController | null>(null);

  // --- The photograph's on-screen rect, which the 3D camera hands off from. ---
  const measure = useCallback(() => {
    const el = photoEl.current;
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

  const photoRef = useCallback(
    (el: HTMLImageElement | null) => {
      photoEl.current = el;
      if (!el) return;
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      window.addEventListener("resize", measure);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", measure);
      };
    },
    [measure],
  );

  // --- Generating a memory. ---
  const fail = useCallback((error: unknown) => {
    if ((error as Error)?.name === "AbortError") return;
    console.error("[again]", error);
    setNotice(error instanceof MemoryError ? error.message : "this memory couldn't be opened");
    dispatch({ type: "FAIL" });
  }, []);

  const follow = useCallback(
    async (jobId: string, prepared: PreparedPhoto) => {
      job.current?.abort();
      const controller = new AbortController();
      job.current = controller;
      try {
        const world = await waitForWorld(jobId, controller.signal);
        const built = await buildMemory(jobId, prepared, world);
        if (controller.signal.aborted) return;
        setMemory(built);
        dispatch({ type: "GENERATED" });
      } catch (error) {
        fail(error);
      }
    },
    [fail],
  );

  const start = useCallback(
    async (file: File) => {
      setNotice(null);
      dispatch({ type: "UPLOAD" });
      try {
        const prepared = await preparePhoto(file);
        setPhoto({ url: prepared.url, aspect: prepared.aspect });
        const jobId = await submitPhoto(prepared.blob);
        await rememberPending(jobId, prepared);
        dispatch({ type: "UPLOADED" });
        await follow(jobId, prepared);
      } catch (error) {
        fail(error);
      }
    },
    [follow, fail],
  );

  // A reload mid-generation picks the same world back up instead of paying for a new one.
  useEffect(() => {
    const pending = recallPending();
    if (!pending) return;
    setPhoto({ url: pending.photo.url, aspect: pending.photo.aspect });
    dispatch({ type: "UPLOAD" });
    dispatch({ type: "UPLOADED" });
    void follow(pending.jobId, pending.photo);
    return () => job.current?.abort();
  }, [follow]);

  const openDemo = useCallback(() => {
    setNotice(null);
    setPhoto({ url: DEMO_MEMORY.photoUrl, aspect: DEMO_MEMORY.photoAspect });
    setMemory(DEMO_MEMORY);
    dispatch({ type: "DEMO" });
  }, []);

  const reset = useCallback(() => {
    job.current?.abort();
    forgetPending();
    if (photo?.url.startsWith("blob:")) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setMemory(null);
    setWorldLoaded(false);
    setNotice(null);
    setReturnSignal(0);
    card.current = null;
    dispatch({ type: "RESET" });
  }, [photo]);

  // --- Entering. ---
  const inWorld = state === "entering" || state === "exploring";
  const canEnter = state === "ready" && worldLoaded;
  const processing = state === "uploading" || state === "generating";
  const showWorld = memory && (state === "ready" || inWorld);

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
      {showWorld && (
        <div className="absolute inset-0 z-0">
          <MemoryWorld
            key={memory.id}
            memory={memory}
            mode={inWorld ? state : "ready"}
            card={card}
            returnSignal={returnSignal}
            onLoaded={() => setWorldLoaded(true)}
            onError={(error) => fail(new MemoryError(`this world couldn't be opened (${error})`))}
            onEntered={() => dispatch({ type: "ENTERED" })}
          />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-4">
        <motion.header
          className="absolute top-[9vh] flex flex-col items-center gap-3 text-center"
          animate={{ opacity: inWorld ? 0 : 1, y: inWorld ? -8 : 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-none tracking-[0.02em]">
            AGAIN.
          </h1>
          <p className={LABEL}>step inside a memory</p>
        </motion.header>

        <AnimatePresence mode="wait">
          {!photo ? (
            <motion.div key="drop" exit={{ opacity: 0, transition: { duration: 0.4 } }}>
              <PhotoDrop onPhoto={start} onProblem={setNotice} />
            </motion.div>
          ) : (
            <motion.div
              key={photo.url}
              className="relative"
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: inWorld ? 0 : 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
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
              {/* A slow breath while the world is being made; perfectly still once it's ready. */}
              <motion.div
                animate={processing ? { scale: [1, 1.012, 1] } : { scale: 1 }}
                transition={
                  processing
                    ? { duration: 9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
                    : { duration: 0.8 }
                }
              >
                {/* biome-ignore lint/performance/noImgElement: a plain img so its rect matches the 3D plane exactly */}
                <img
                  ref={photoRef}
                  src={photo.url}
                  alt="The photograph this memory is made from"
                  onLoad={measure}
                  draggable={false}
                  className="relative block select-none"
                  style={{
                    height: `min(50vh, calc(78vw / ${photo.aspect}))`,
                    aspectRatio: String(photo.aspect),
                  }}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute bottom-[10vh] flex h-28 flex-col items-center justify-end gap-5">
          <AnimatePresence mode="wait">
            {state === "idle" && (
              <motion.div
                key="idle"
                className="flex flex-col items-center gap-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.3 } }}
                transition={{ duration: 1.4, delay: 0.4 }}
              >
                {notice && <p className={`${LABEL} text-bone/70`}>{notice}</p>}
                <button type="button" onClick={openDemo} className={QUIET_BUTTON}>
                  or enter a memory
                </button>
              </motion.div>
            )}

            {processing && (
              <motion.div key="processing" exit={{ opacity: 0, transition: { duration: 0.4 } }}>
                <ProcessingCopy phase={state} />
              </motion.div>
            )}

            {state === "ready" && !worldLoaded && (
              <motion.p
                key="remembering"
                className={LABEL}
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
                <p className={LABEL}>memory ready</p>
                <button
                  type="button"
                  onClick={stepInside}
                  className="pointer-events-auto border border-bone/30 px-8 py-3 font-mono text-[12px] uppercase tracking-[0.4em] text-bone transition-colors duration-500 hover:border-bone/80 hover:bg-bone/5 focus-visible:border-bone focus-visible:outline-none"
                >
                  Step inside
                </button>
              </motion.div>
            )}

            {state === "error" && (
              <motion.div
                key="error"
                className="flex flex-col items-center gap-5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className={`${LABEL} text-bone/70`}>
                  {notice ?? "this memory couldn't be opened"}
                </p>
                <button type="button" onClick={reset} className={QUIET_BUTTON}>
                  try another photo
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {(processing || state === "ready") && (
          <button
            type="button"
            onClick={reset}
            className={`${QUIET_BUTTON} absolute right-6 bottom-6`}
          >
            {processing ? "let go" : "another memory"}
          </button>
        )}
      </div>

      <AnimatePresence>
        {state === "exploring" && (
          <ExploreHud onReturn={() => setReturnSignal((n) => n + 1)} onLeave={reset} />
        )}
      </AnimatePresence>

      <div className="grain pointer-events-none absolute z-30" />
      <div className="vignette pointer-events-none absolute inset-0 z-30" />
    </main>
  );
}

function ExploreHud({ onReturn, onLeave }: { onReturn: () => void; onLeave: () => void }) {
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
        onClick={onLeave}
        className={`${QUIET_BUTTON} absolute bottom-6 left-6`}
      >
        another memory
      </button>
      <button
        type="button"
        onClick={onReturn}
        className={`${QUIET_BUTTON} absolute right-6 bottom-6`}
      >
        return to photo
      </button>
    </motion.div>
  );
}
