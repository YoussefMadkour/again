"use client";

import { motion } from "framer-motion";
import { type FormEvent, useState } from "react";
import type { Access } from "@/lib/experience/memory-client";

export interface AccessOptions {
  /** Generating on the owner's key needs a code. */
  requireCode: boolean;
  /** The owner's key is configured, so codes can work at all. */
  ownerKey: boolean;
  /** Where to ask for a trial code (a DM link). */
  contactUrl: string | null;
}

interface Props extends AccessOptions {
  notice: string | null;
  /** A code that worked before on this device. */
  initialCode?: string | null;
  onSubmit: (access: Access) => void;
}

const INPUT =
  "pointer-events-auto w-60 border-b border-bone/25 bg-transparent px-1 py-2 text-center font-mono text-[12px] tracking-[0.2em] text-bone placeholder:text-bone/30 focus:border-bone/70 focus:outline-none";
const LINK =
  "pointer-events-auto font-mono text-[10px] lowercase tracking-[0.25em] text-bone/40 underline-offset-4 transition-colors hover:text-bone/90 hover:underline focus-visible:text-bone focus-visible:outline-none";

export function AccessPanel({ ownerKey, contactUrl, notice, initialCode, onSubmit }: Props) {
  const [mode, setMode] = useState<"code" | "key">(ownerKey ? "code" : "key");
  const [value, setValue] = useState(ownerKey ? (initialCode ?? "") : "");
  const [share, setShare] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onSubmit(mode === "code" ? { code: v, share } : { apiKey: v, share });
  };

  return (
    <motion.form
      onSubmit={submit}
      className="flex flex-col items-center gap-4"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      transition={{ duration: 0.9 }}
      data-testid="access-panel"
    >
      <p className="font-mono text-[11px] lowercase tracking-[0.35em] text-bone/55">
        {notice ?? (mode === "code" ? "this memory needs an access code" : "use your own key")}
      </p>

      <div className="flex items-center gap-3">
        <input
          key={mode}
          // biome-ignore lint/a11y/noAutofocus: the panel appears because this is the next thing to do
          autoFocus
          type={mode === "key" ? "password" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === "code" ? "access code" : "world labs api key"}
          aria-label={mode === "code" ? "Access code" : "World Labs API key"}
          autoComplete="off"
          spellCheck={false}
          className={INPUT}
        />
        <button
          type="submit"
          className="pointer-events-auto border border-bone/30 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.35em] text-bone transition-colors hover:border-bone/80 focus-visible:border-bone focus-visible:outline-none"
        >
          Enter
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {mode === "code" ? (
          <>
            {contactUrl && (
              <a href={contactUrl} target="_blank" rel="noreferrer" className={LINK}>
                ask for a trial ↗
              </a>
            )}
            <button
              type="button"
              className={LINK}
              onClick={() => {
                setMode("key");
                setValue("");
              }}
            >
              use your own world labs key
            </button>
          </>
        ) : (
          <>
            <a
              href="https://platform.worldlabs.ai/api-keys"
              target="_blank"
              rel="noreferrer"
              className={LINK}
            >
              get a key ↗
            </a>
            {ownerKey && (
              <button
                type="button"
                className={LINK}
                onClick={() => {
                  setMode("code");
                  setValue("");
                }}
              >
                use an access code
              </button>
            )}
          </>
        )}
      </div>
      {mode === "key" && (
        <p className="max-w-80 text-center font-mono text-[9px] lowercase leading-relaxed tracking-[0.2em] text-bone/35">
          used for this memory only and never stored. a world costs about $1.26 of your credits.
        </p>
      )}

      <label className="pointer-events-auto flex cursor-pointer items-center gap-2 font-mono text-[10px] lowercase tracking-[0.25em] text-bone/45">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
          className="size-3 accent-[#f2f0ea]"
        />
        add this memory to the public gallery
      </label>
    </motion.form>
  );
}
