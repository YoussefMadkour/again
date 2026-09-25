"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import type { WorldFx } from "./fx";

export interface PlacedSound {
  id: string;
  url: string;
  /** Null for ambience; a world position for sounds that come from something. */
  position: THREE.Vector3 | null;
  /** A score: under the room's own sound, and from the top rather than mid-loop. */
  music?: boolean;
}

interface Props {
  sounds: PlacedSound[];
  fx: RefObject<WorldFx>;
  muted: boolean;
}

const AMBIENT_GAIN = 0.55;
const POSITIONAL_GAIN = 0.9;
const MUSIC_GAIN = 0.32;
/** Metres (roughly) at which a positional sound starts to fall off. */
const REF_DISTANCE = 0.8;

/**
 * The memory's sound. Silent before entering, faint while the camera approaches the photo,
 * fully present once through it: entering a place, not loading a model.
 */
export function SpatialAudio({ sounds, fx, muted }: Props) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const listener = useRef<THREE.AudioListener | null>(null);
  const master = useRef(0);

  useEffect(() => {
    const l = new THREE.AudioListener();
    camera.add(l);
    listener.current = l;
    l.setMasterVolume(0);
    return () => {
      camera.remove(l);
      listener.current = null;
    };
  }, [camera]);

  const soundKey = sounds.map((s) => s.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: sounds are keyed by id
  useEffect(() => {
    const l = listener.current;
    if (!l) return;
    const loader = new THREE.AudioLoader();
    const created: (THREE.Audio | THREE.PositionalAudio)[] = [];
    let cancelled = false;
    for (const s of sounds) {
      const audio = s.position ? new THREE.PositionalAudio(l) : new THREE.Audio(l);
      if (s.position && audio instanceof THREE.PositionalAudio) {
        audio.position.copy(s.position);
        audio.setRefDistance(REF_DISTANCE);
        audio.setRolloffFactor(1.4);
        audio.setDistanceModel("inverse");
        scene.add(audio);
      }
      created.push(audio);
      loader.load(
        s.url,
        (buffer) => {
          if (cancelled) return;
          audio.setBuffer(buffer);
          audio.setLoop(true);
          audio.setVolume(s.music ? MUSIC_GAIN : s.position ? POSITIONAL_GAIN : AMBIENT_GAIN);
          // Stagger loop starts so layered loops don't pulse together (music starts at the top).
          audio.offset = s.music ? 0 : Math.random() * buffer.duration;
          audio.play();
        },
        undefined,
        (error) => console.warn("[again] sound failed to load", s.id, error),
      );
    }
    return () => {
      cancelled = true;
      for (const a of created) {
        if (a.isPlaying) a.stop();
        a.removeFromParent();
        a.disconnect();
      }
    };
  }, [soundKey, scene]);

  useFrame((_, dt) => {
    const l = listener.current;
    if (!l) return;
    // World fading in with the photo still up: faint. Photo gone: full.
    const { worldOpacity, photoOpacity } = fx.current;
    const target = muted ? 0 : worldOpacity * (1 - 0.7 * photoOpacity);
    master.current += (target - master.current) * Math.min(1, dt * 2);
    l.setMasterVolume(master.current);
  });

  return null;
}

/** Browsers only allow audio after a user gesture; call from the STEP INSIDE click. */
export function unlockAudio() {
  const ctx = THREE.AudioContext.getContext();
  if (ctx.state === "suspended") void ctx.resume();
}
