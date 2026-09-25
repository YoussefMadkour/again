"use client";

import { motion } from "framer-motion";
import { useDropzone } from "react-dropzone";
import { ACCEPTED_PHOTO_TYPES, MAX_PHOTO_BYTES, photoProblem } from "@/lib/upload";

interface Props {
  onPhoto: (file: File) => void;
  onProblem: (message: string) => void;
}

const accept = Object.fromEntries(
  Object.entries(ACCEPTED_PHOTO_TYPES).map(([type, ext]) => [
    type,
    ext === "jpg" ? [".jpg", ".jpeg"] : [`.${ext}`],
  ]),
);

export function PhotoDrop({ onPhoto, onProblem }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    maxSize: MAX_PHOTO_BYTES,
    multiple: false,
    onDropAccepted: ([file]) => onPhoto(file),
    onDropRejected: ([rejection]) =>
      onProblem(
        rejection
          ? (photoProblem(rejection.file) ?? "this photo can't be used")
          : "one photo at a time",
      ),
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.4 }}
      className="pointer-events-auto flex flex-col items-center gap-6"
    >
      <div
        {...getRootProps()}
        className={`flex aspect-[4/3] w-[min(22rem,70vw)] cursor-pointer items-center justify-center border transition-colors duration-700 focus-visible:outline-none ${
          isDragActive
            ? "border-bone/70 bg-bone/[0.04]"
            : "border-bone/20 hover:border-bone/45 focus-visible:border-bone/60"
        }`}
        data-testid="photo-drop"
      >
        <input {...getInputProps()} aria-label="Choose a photograph" />
        <span className="font-display text-4xl leading-none font-light text-bone/60">+</span>
      </div>
      <p className="font-mono text-[11px] lowercase tracking-[0.35em] text-bone/55">
        drop a memory
      </p>
    </motion.div>
  );
}

/** The quiet way in for your own photograph: a line under the memories (click, or drop on it). */
export function BringPhoto({ onPhoto, onProblem }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    maxSize: MAX_PHOTO_BYTES,
    multiple: false,
    onDropAccepted: ([file]) => onPhoto(file),
    onDropRejected: ([rejection]) =>
      onProblem(
        rejection
          ? (photoProblem(rejection.file) ?? "this photo can't be used")
          : "one photo at a time",
      ),
  });
  return (
    <div
      {...getRootProps()}
      className={`pointer-events-auto cursor-pointer border-b pb-1 font-mono text-[10px] lowercase tracking-[0.3em] transition-colors duration-500 focus-visible:outline-none ${
        isDragActive
          ? "border-bone/60 text-bone/80"
          : "border-transparent text-bone/40 hover:text-bone/70 focus-visible:text-bone/70"
      }`}
      data-testid="photo-drop"
    >
      <input {...getInputProps()} aria-label="Choose a photograph" />
      or bring your own photograph
    </div>
  );
}
