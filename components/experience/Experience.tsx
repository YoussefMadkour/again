"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { unlockAudio } from "@/components/world/SpatialAudio";
import { DEMO_EXTRAS } from "@/lib/demo/extras";
import { DEMO_MEMORY, type Memory } from "@/lib/demo/memory";
import {
  type Access,
  AccessError,
  buildMemory,
  forgetPending,
  MemoryError,
  openExistingWorld,
  type PreparedPhoto,
  preparePhoto,
  recallPending,
  rememberPending,
  saveCode,
  savedCode,
  submitPhoto,
  waitForWorld,
  watchExtras,
} from "@/lib/experience/memory-client";
import { type ExperienceEvent, type ExperienceState, nextState } from "@/lib/experience/state";
import type { GalleryCard } from "@/lib/gallery";
import type { PublicExtras } from "@/lib/pipeline/extras";
import type { CardRect } from "@/lib/world/entry";
import { type AccessOptions, AccessPanel } from "./AccessPanel";
import { EvidencePanel } from "./EvidencePanel";
import { Gallery } from "./Gallery";
import { PhotoDrop } from "./PhotoDrop";
import { ProcessingCopy } from "./ProcessingCopy";
import { BeyondOverlay, MemoryDreamSlider, ProvenanceLegend } from "./Provenance";

const MemoryWorld = dynamic(() => import("@/components/world/MemoryWorld"), { ssr: false });

const EASE = [0.22, 1, 0.36, 1] as const;
const LABEL = "font-mono text-[11px] lowercase tracking-[0.35em] text-bone/55";
const QUIET_BUTTON =
  "pointer-events-auto font-mono text-[10px] lowercase tracking-[0.3em] text-bone/40 transition-colors duration-500 hover:text-bone/90 focus-visible:text-bone focus-visible:outline-none";
const UUID = /^[0-9a-f-]{36}$/i;
const GALLERY_ID = /^[0-9a-f]{16}$/i;

function reducer(state: ExperienceState, event: ExperienceEvent) {
  return nextState(state, event);
}

interface Photo {
  url: string;
  aspect: number;
}

interface Props {
  gallery: GalleryCard[];
  access: AccessOptions;
}

export function Experience({ gallery, access }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, "idle");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [worldLoaded, setWorldLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [returnSignal, setReturnSignal] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [extras, setExtras] = useState<PublicExtras | undefined>();
  const [muted, setMuted] = useState(false);
  /** The hero object whose photographic evidence is showing. */
  const [evidence, setEvidence] = useState<string | null>(null);
  /** 0 = MEMORY, 1 = DREAM. Starts leaning to the dream, so the world is whole but the
   * unseen parts are a little quieter than the photographed ones. */
  const [dream, setDream] = useState(0.75);
  const [revealing, setRevealing] = useState(false);
  const [beyond, setBeyond] = useState(false);
  const card = useRef<CardRect | null>(null);
  const photoEl = useRef<HTMLImageElement | null>(null);
  const job = useRef<AbortController | null>(null);
  /** The photo waiting for an access code or key. */
  const waiting = useRef<PreparedPhoto | null>(null);

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
    async (jobId: string, prepared: PreparedPhoto, apiKey?: string) => {
      job.current?.abort();
      const controller = new AbortController();
      job.current = controller;
      try {
        const { world, extras: first } = await waitForWorld(jobId, controller.signal, apiKey);
        const built = await buildMemory(jobId, prepared, world);
        if (controller.signal.aborted) return;
        setMemory(built);
        setExtras(first);
        dispatch({ type: "GENERATED" });
        // Objects and sound keep arriving after the world is ready.
        if (first && !first.done) void watchExtras(jobId, controller.signal, setExtras, apiKey);
      } catch (error) {
        fail(error);
      }
    },
    [fail],
  );

  const submit = useCallback(
    async (prepared: PreparedPhoto, credentials: Access) => {
      setNotice(null);
      dispatch({ type: "UPLOAD" });
      try {
        const jobId = await submitPhoto(prepared.blob, credentials);
        if (credentials.code) saveCode(credentials.code);
        waiting.current = null;
        await rememberPending(jobId, prepared, credentials.apiKey);
        dispatch({ type: "UPLOADED" });
        await follow(jobId, prepared, credentials.apiKey);
      } catch (error) {
        if (error instanceof AccessError) {
          if (credentials.code && error.status === 403) saveCode(null);
          waiting.current = prepared;
          setNotice(error.message);
          dispatch({ type: "DENIED" });
          return;
        }
        fail(error);
      }
    },
    [follow, fail],
  );

  const choose = useCallback(
    async (file: File) => {
      setNotice(null);
      let prepared: PreparedPhoto;
      try {
        prepared = await preparePhoto(file);
      } catch (error) {
        setNotice(error instanceof MemoryError ? error.message : "this photo couldn't be read");
        return;
      }
      setPhoto({ url: prepared.url, aspect: prepared.aspect });
      if (access.requireCode) {
        waiting.current = prepared;
        dispatch({ type: "UNLOCK" });
      } else {
        await submit(prepared, { share: false });
      }
    },
    [access.requireCode, submit],
  );

  const openExisting = useCallback(
    (jobId: string) => {
      const controller = new AbortController();
      job.current?.abort();
      job.current = controller;
      setNotice(null);
      dispatch({ type: "UPLOAD" });
      openExistingWorld(jobId, controller.signal)
        .then(({ photo: existing }) => {
          setPhoto({ url: existing.url, aspect: existing.aspect });
          dispatch({ type: "UPLOADED" });
          return follow(jobId, existing);
        })
        .catch(fail);
    },
    [follow, fail],
  );

  // `?memory=<gallery id>` and `?world=<world id>` open existing memories for free.
  // Otherwise, a reload mid-generation picks the same job back up instead of paying again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const galleryId = params.get("memory");
    const worldId = params.get("world");
    if (galleryId && GALLERY_ID.test(galleryId)) {
      openExisting(`gallery_${galleryId}`);
    } else if (worldId && UUID.test(worldId)) {
      openExisting(`world_${worldId}`);
    } else {
      const pending = recallPending();
      if (pending) {
        setPhoto({ url: pending.photo.url, aspect: pending.photo.aspect });
        dispatch({ type: "UPLOAD" });
        dispatch({ type: "UPLOADED" });
        void follow(pending.jobId, pending.photo, pending.apiKey);
      }
    }
    return () => job.current?.abort();
  }, [follow, openExisting]);

  const openGallery = useCallback(
    (id: string) => {
      window.history.replaceState(null, "", `?memory=${id}`);
      openExisting(`gallery_${id}`);
    },
    [openExisting],
  );

  const openDemo = useCallback(() => {
    setNotice(null);
    setPhoto({ url: DEMO_MEMORY.photoUrl, aspect: DEMO_MEMORY.photoAspect });
    setMemory(DEMO_MEMORY);
    setExtras(DEMO_EXTRAS);
    dispatch({ type: "DEMO" });
  }, []);

  const reset = useCallback(() => {
    job.current?.abort();
    forgetPending();
    // Drop ?world= / ?memory= so "another memory" really starts fresh.
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    if (photo?.url.startsWith("blob:")) URL.revokeObjectURL(photo.url);
    waiting.current = null;
    setPhoto(null);
    setMemory(null);
    setExtras(undefined);
    setEvidence(null);
    setBeyond(false);
    setRevealing(false);
    setWorldLoaded(false);
    setNotice(null);
    setReturnSignal(0);
    setScrolled(false);
    card.current = null;
    dispatch({ type: "RESET" });
    // Pick up memories shared since the page loaded (including, maybe, this one).
    router.refresh();
  }, [photo, router]);

  // --- Entering. ---
  const inWorld = state === "entering" || state === "exploring";
  const canEnter = state === "ready" && worldLoaded;
  const processing = state === "uploading" || state === "generating";
  const showWorld = memory && (state === "ready" || inWorld);
  const idle = state === "idle";

  const stepInside = useCallback(() => {
    if (!canEnter) return;
    measure();
    // The click is the user gesture browsers need before sound can play.
    unlockAudio();
    dispatch({ type: "STEP_INSIDE" });
  }, [canEnter, measure]);

  // Hold SPACE to see what the photograph saw.
  useEffect(() => {
    if (state !== "exploring") return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      if (!e.repeat) setRevealing(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setRevealing(false);
    };
    const blur = () => setRevealing(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [state]);

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
            extras={extras}
            mode={inWorld ? state : "ready"}
            card={card}
            returnSignal={returnSignal}
            muted={muted}
            onSelectObject={(id) => state === "exploring" && setEvidence(id)}
            dream={dream}
            revealing={revealing}
            frozen={Boolean(evidence) || beyond}
            onBeyond={() => {
              if (!onceThisSession("again:beyond-seen")) return;
              setBeyond(true);
            }}
            onLoaded={() => setWorldLoaded(true)}
            onError={(error) => fail(new MemoryError(`this world couldn't be opened (${error})`))}
            onEntered={() => dispatch({ type: "ENTERED" })}
          />
        </div>
      )}

      <motion.header
        className="pointer-events-none absolute top-[9vh] left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-3 text-center"
        animate={{ opacity: inWorld || (idle && scrolled) ? 0 : 1, y: inWorld ? -8 : 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-none tracking-[0.02em]">
          AGAIN.
        </h1>
        <p className={`${LABEL} whitespace-nowrap`}>step inside a memory</p>
      </motion.header>

      <AnimatePresence mode="wait">
        {idle ? (
          // Home: the drop zone fills the first screen; shared memories are below it.
          <motion.div
            key="home"
            className="absolute inset-0 z-10 overflow-y-auto overscroll-contain"
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            data-testid="home"
          >
            <section className="relative flex h-[100svh] flex-col items-center justify-center px-4">
              <PhotoDrop onPhoto={choose} onProblem={setNotice} />
              <motion.div
                className="absolute bottom-[10vh] flex flex-col items-center gap-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.4, delay: 0.4 }}
              >
                {notice && <p className={`${LABEL} text-bone/70`}>{notice}</p>}
                <button type="button" onClick={openDemo} className={QUIET_BUTTON}>
                  or enter a memory
                </button>
              </motion.div>
              {gallery.length > 0 && (
                <motion.p
                  className="absolute bottom-6 font-mono text-[9px] lowercase tracking-[0.35em] text-bone/30"
                  animate={{ opacity: scrolled ? 0 : 1 }}
                >
                  other memories ↓
                </motion.p>
              )}
            </section>
            <Gallery cards={gallery} onOpen={openGallery} />
          </motion.div>
        ) : (
          <motion.div
            key="memory"
            className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {photo && (
              <motion.div
                key={photo.url}
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
                    className="relative block select-none transition-[height] duration-700"
                    style={{
                      height: `min(${state === "unlocking" ? 40 : 50}vh, calc(78vw / ${photo.aspect}))`,
                      aspectRatio: String(photo.aspect),
                    }}
                  />
                </motion.div>
              </motion.div>
            )}

            <div className="absolute bottom-[8vh] flex min-h-28 flex-col items-center justify-end gap-5">
              <AnimatePresence mode="wait">
                {state === "unlocking" && (
                  <AccessPanel
                    key="access"
                    {...access}
                    initialCode={savedCode()}
                    notice={notice}
                    onSubmit={(credentials) => {
                      const prepared = waiting.current;
                      if (prepared) void submit(prepared, credentials);
                    }}
                  />
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

            {(processing || state === "ready" || state === "unlocking") && (
              <button
                type="button"
                onClick={reset}
                className={`${QUIET_BUTTON} absolute right-6 bottom-6`}
              >
                {processing ? "let go" : "another memory"}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state === "exploring" && (
          <ExploreHud
            onReturn={() => setReturnSignal((n) => n + 1)}
            onLeave={reset}
            muted={muted}
            onToggleSound={() => setMuted((m) => !m)}
            hasSound={Boolean(extras?.sounds.some((s) => s.state === "done"))}
            hasObjects={Boolean(extras?.objects.some((o) => o.state === "done"))}
            dream={dream}
            onDream={setDream}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state === "exploring" && revealing && <ProvenanceLegend key="legend" />}
      </AnimatePresence>

      <AnimatePresence>
        {beyond && (
          <BeyondOverlay
            onContinue={() => setBeyond(false)}
            onReturn={() => {
              setBeyond(false);
              setReturnSignal((n) => n + 1);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {evidence &&
          photo &&
          extras &&
          (() => {
            const object = extras.objects.find((o) => o.id === evidence);
            return object ? (
              <EvidencePanel photo={photo} object={object} onClose={() => setEvidence(null)} />
            ) : null;
          })()}
      </AnimatePresence>

      <div className="grain pointer-events-none absolute z-30" />
      <div className="vignette pointer-events-none absolute inset-0 z-30" />
    </main>
  );
}

function ExploreHud({
  onReturn,
  onLeave,
  muted,
  onToggleSound,
  hasSound,
  hasObjects,
  dream,
  onDream,
}: {
  onReturn: () => void;
  onLeave: () => void;
  muted: boolean;
  onToggleSound: () => void;
  hasSound: boolean;
  hasObjects: boolean;
  dream: number;
  onDream: (v: number) => void;
}) {
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
        className="absolute bottom-20 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] lowercase tracking-[0.3em] text-bone/45"
        animate={{ opacity: hintVisible ? 1 : 0 }}
        transition={{ duration: 1.5 }}
      >
        drag to look · wasd to move · hold space to see what the photo saw
        {hasObjects && " · click what glows"}
      </motion.p>
      <div className="absolute bottom-7 left-1/2 -translate-x-1/2">
        <MemoryDreamSlider value={dream} onChange={onDream} />
      </div>
      {hasSound && (
        <button
          type="button"
          onClick={onToggleSound}
          className={`${QUIET_BUTTON} absolute top-6 right-6`}
        >
          {muted ? "sound off" : "sound on"}
        </button>
      )}
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

/** True the first time it's asked this session (per key); false after, or without storage. */
function onceThisSession(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}
