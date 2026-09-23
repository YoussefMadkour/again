"use client";

import { motion } from "framer-motion";
import type { GalleryCard } from "@/lib/gallery";

interface Props {
  cards: GalleryCard[];
  onOpen: (id: string) => void;
}

/** Memories people chose to share. The photograph, and on hover, the world it became. */
export function Gallery({ cards, onOpen }: Props) {
  if (cards.length === 0) return null;
  return (
    <section
      className="mx-auto w-full max-w-6xl px-4 pt-8 pb-24 sm:px-8"
      aria-label="Shared memories"
    >
      <p className="mb-10 text-center font-mono text-[11px] lowercase tracking-[0.35em] text-bone/45">
        other memories
      </p>
      <ul className="flex flex-wrap justify-center gap-8">
        {cards.map((card, i) => (
          <motion.li
            key={card.id}
            className="w-full sm:w-[calc(50%-1rem)] lg:w-[calc(33.333%-1.35rem)]"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 1, delay: (i % 3) * 0.08 }}
          >
            <button
              type="button"
              onClick={() => onOpen(card.id)}
              className="group relative block aspect-[4/3] w-full overflow-hidden bg-ink outline-offset-4 focus-visible:outline focus-visible:outline-1 focus-visible:outline-bone/60"
              aria-label="Step inside this memory"
              data-testid="gallery-card"
            >
              {/* biome-ignore lint/performance/noImgElement: remote CDN images, no optimizer needed */}
              <img
                src={card.photoUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover transition-[opacity,transform] duration-[1400ms] ease-out group-hover:scale-[1.03] group-focus-visible:scale-[1.03]"
              />
              {card.thumbnailUrl && (
                // biome-ignore lint/performance/noImgElement: remote CDN images, no optimizer needed
                <img
                  src={card.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full scale-[1.03] object-cover opacity-0 transition-opacity duration-[1400ms] ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              )}
              <span className="absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]" />
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[9px] lowercase tracking-[0.3em] whitespace-nowrap text-bone/0 transition-colors duration-700 group-hover:text-bone/75 group-focus-visible:text-bone/75">
                step inside
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
