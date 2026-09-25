"use client";

import { motion } from "framer-motion";
import { type PointerEvent, useEffect, useRef, useState } from "react";

export interface CarouselMemory {
  id: string;
  photoUrl: string;
  /** Screen-reader name of the card (and the button's role name). */
  label: string;
  /** Shared memories keep the gallery's test id. */
  testId?: string;
  /** The real photograph, when this one is a restoration of it: shown with a before/after slider. */
  originalUrl?: string;
  onOpen: () => void;
}

interface Props {
  memories: CarouselMemory[];
}

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The photographs to walk into, as a coverflow: the one in front faces you, the others turn
 * away to either side. Hovering one brings it round to the front; clicking one walks in.
 * Arrow keys move, Enter walks in.
 */
export function MemoryCarousel({ memories }: Props) {
  const [active, setActive] = useState(0);
  const count = memories.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // The before/after handle uses the arrows itself.
      if (e.target instanceof HTMLElement && e.target.getAttribute("role") === "slider") return;
      if (e.key === "ArrowRight") setActive((a) => Math.min(count - 1, a + 1));
      else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, a - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  if (count === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.4 }}
      className="pointer-events-auto flex w-full flex-col items-center gap-8"
    >
      <ul
        className="relative aspect-[4/3] w-[min(26rem,72vw)]"
        style={{ perspective: "1400px", transformStyle: "preserve-3d" }}
        aria-label="Memories"
      >
        {memories.map((m, i) => {
          const offset = i - active;
          const side = Math.sign(offset);
          const far = Math.abs(offset);
          return (
            <motion.li
              key={m.id}
              className="absolute inset-0"
              style={{ zIndex: 100 - far, transformStyle: "preserve-3d" }}
              animate={{
                x: `${offset === 0 ? 0 : side * (72 + (far - 1) * 26)}%`,
                z: offset === 0 ? 0 : -260 - (far - 1) * 90,
                rotateY: offset === 0 ? 0 : -side * 52,
                opacity: far > 3 ? 0 : 1 - far * 0.22,
              }}
              transition={{ duration: 0.7, ease: EASE }}
            >
              {m.originalUrl && <BeforeAfter original={m.originalUrl} active={offset === 0} />}
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={m.onOpen}
                aria-label={m.label}
                data-testid={m.testId}
                className="group relative block size-full overflow-hidden bg-ink outline-offset-4 focus-visible:outline focus-visible:outline-1 focus-visible:outline-bone/60"
              >
                {/* biome-ignore lint/performance/noImgElement: photographs shown as they are */}
                <img
                  src={m.photoUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.03]"
                />
                <span
                  className={`absolute inset-0 transition-colors duration-700 ${
                    offset === 0
                      ? "shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]"
                      : "bg-black/35 shadow-[inset_0_0_60px_rgba(0,0,0,0.7)]"
                  }`}
                />
              </button>
            </motion.li>
          );
        })}
      </ul>
      <div className="flex flex-col items-center gap-3">
        <p className="font-mono text-[11px] lowercase tracking-[0.35em] text-bone/55">
          click the photograph to walk in
        </p>
        {count > 1 && (
          <div className="flex gap-2" aria-hidden>
            {memories.map((m, i) => (
              <span
                key={m.id}
                className={`size-1 rounded-full transition-colors duration-500 ${
                  i === active ? "bg-bone/70" : "bg-bone/20"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * The original over the restored photograph, split by a draggable divider: the original to
 * its left. On the front card only; the card underneath still walks in when clicked.
 */
function BeforeAfter({ original, active }: { original: string; active: boolean }) {
  const [split, setSplit] = useState(50);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const moveTo = (e: PointerEvent) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
  };
  return (
    <div ref={frame} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {/* biome-ignore lint/performance/noImgElement: photographs shown as they are */}
      <img
        src={original}
        alt=""
        className="absolute inset-0 size-full object-cover"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      />
      <span
        className="absolute inset-y-0 w-px bg-bone/80 transition-opacity duration-500"
        style={{ left: `${split}%`, opacity: active ? 1 : 0 }}
      />
      {active && (
        <>
          <span className="absolute top-3 left-3 font-mono text-[9px] lowercase tracking-[0.3em] text-bone/80">
            original
          </span>
          <span className="absolute top-3 right-3 font-mono text-[9px] lowercase tracking-[0.3em] text-bone/80">
            in colour
          </span>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Compare the original photograph with the colour version"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split)}
            className="pointer-events-auto absolute top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-bone/90 text-[13px] text-ink shadow-lg backdrop-blur focus-visible:outline focus-visible:outline-1 focus-visible:outline-bone"
            style={{ left: `${split}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => dragging.current && moveTo(e)}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setSplit((v) => Math.max(0, v - 5));
              if (e.key === "ArrowRight") setSplit((v) => Math.min(100, v + 5));
            }}
          >
            ‹›
          </div>
        </>
      )}
    </div>
  );
}
