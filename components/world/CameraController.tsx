"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OriginalCamera } from "@/lib/demo/memory";
import { type CardRect, clamp01, ENTRY, entryFrame, handoffOffset } from "@/lib/world/entry";
import type { WorldFx } from "./fx";
import { directionEdge } from "./provenance";

export type WorldMode = "ready" | "entering" | "exploring" | "capture";

interface Props {
  mode: WorldMode;
  original: OriginalCamera;
  card: RefObject<CardRect | null>;
  fx: RefObject<WorldFx>;
  /** Incrementing this sends the camera back to the photograph's viewpoint. */
  returnSignal: number;
  onEntered: () => void;
  /** Input is ignored while an overlay is up. */
  frozen?: boolean;
  /** Called once, the first time the view turns well beyond what the photograph saw. */
  onBeyond?: () => void;
  photoAspect: number;
}

/** How far past the photo's edge the view must point to count as "beyond" (1 = the edge). */
const BEYOND_EDGE = 1.7;

const LOOK_SPEED = 0.0032;
const MAX_PITCH = 1.1;
const MOVE_SPEED = 1.1;
const WHEEL_SPEED = 0.0012;
/** Soft limit on how far you can wander from where the photo was taken. */
const ROOM_RADIUS = 2.2;

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const _yaw = new THREE.Quaternion();
const _pitch = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Owns the camera: the scripted entry through the photo, then a gentle free camera.
 * Movement is heavily damped so it feels like drifting through a place, not a shooter.
 */
export function CameraController({
  mode,
  original,
  card,
  fx,
  returnSignal,
  onEntered,
  frozen = false,
  onBeyond,
  photoAspect,
}: Props) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const dom = useThree((s) => s.gl.domElement);

  const base = useMemo(() => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...original.rotation, "YXZ"));
    return { q, p: new THREE.Vector3(...original.position) };
  }, [original]);

  const s = useRef({
    t: 0,
    handoff: { x: 0, y: 0, z: 2 },
    entered: false,
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    /** Offset from the original camera, world space. */
    offset: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    keys: new Set<string>(),
    wheel: 0,
    returning: false,
    /** Resting at the original viewpoint with the photograph laid back over the world. */
    memoryView: false,
  });

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const beyond = useRef({ reported: false, onBeyond });
  beyond.current.onBeyond = onBeyond;

  useEffect(() => {
    if (frozen) s.current.keys.clear();
  }, [frozen]);

  useEffect(() => {
    camera.fov = original.fov;
    camera.near = 0.01;
    camera.far = 200;
    camera.updateProjectionMatrix();
  }, [camera, original.fov]);

  useEffect(() => {
    if (mode === "entering") {
      s.current.t = 0;
      s.current.entered = false;
    }
  }, [mode]);

  useEffect(() => {
    if (returnSignal > 0) s.current.returning = true;
  }, [returnSignal]);

  useEffect(() => {
    const state = s.current;
    const exploring = () => modeRef.current === "exploring" && !frozenRef.current;
    const wake = () => {
      state.memoryView = false;
      state.returning = false;
    };
    let dragging: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (!exploring()) return;
      dragging = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || !exploring()) return;
      wake();
      state.targetYaw -= (e.clientX - dragging.x) * LOOK_SPEED;
      state.targetPitch = THREE.MathUtils.clamp(
        state.targetPitch - (e.clientY - dragging.y) * LOOK_SPEED,
        -MAX_PITCH,
        MAX_PITCH,
      );
      dragging = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      dragging = null;
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      if (!exploring()) return;
      e.preventDefault();
      wake();
      state.wheel += -e.deltaY * WHEEL_SPEED;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!exploring()) return;
      if (e.code === "Escape") {
        state.returning = true;
        return;
      }
      if (e.code in MOVE_KEYS) {
        e.preventDefault();
        wake();
        state.keys.add(e.code);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => state.keys.delete(e.code);
    const onBlur = () => state.keys.clear();

    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointercancel", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointercancel", onUp);
      dom.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [dom]);

  useFrame((_, rawDt) => {
    const state = s.current;
    const dt = Math.min(rawDt, 1 / 30);
    const m = modeRef.current;

    if (m === "capture") {
      camera.position.copy(base.p);
      camera.quaternion.copy(base.q);
      fx.current.worldOpacity = 1;
      fx.current.photoOpacity = 0;
      return;
    }

    if (m === "ready") {
      if (card.current) state.handoff = handoffOffset(card.current, original.fov);
      placeLocal(camera, base, state.handoff.x, state.handoff.y, state.handoff.z);
      fx.current.worldOpacity = 0;
      fx.current.photoOpacity = 1;
      fx.current.photoFeather = 0;
      fx.current.photoGlued = false;
      return;
    }

    if (m === "entering") {
      state.t += dt;
      const f = entryFrame(state.t);
      const { x, y, z } = state.handoff;
      placeLocal(camera, base, x * f.approach, y * f.approach, z * f.approach - f.push);
      fx.current.worldOpacity = f.worldOpacity;
      fx.current.photoOpacity = f.photoOpacity;
      fx.current.photoFeather = f.photoFeather;
      fx.current.photoGlued = state.t >= ENTRY.arrive;
      if (f.done && !state.entered) {
        state.entered = true;
        state.offset.set(0, 0, -f.push).applyQuaternion(base.q);
        state.velocity.set(0, 0, 0);
        state.yaw = state.targetYaw = 0;
        state.pitch = state.targetPitch = 0;
        onEntered();
      }
      return;
    }

    // exploring
    if (state.returning) {
      const k = 1 - Math.exp(-dt * 2.2);
      state.targetYaw = THREE.MathUtils.lerp(state.targetYaw, 0, k);
      state.targetPitch = THREE.MathUtils.lerp(state.targetPitch, 0, k);
      state.offset.lerp(_v.set(0, 0, 0), k);
      state.velocity.multiplyScalar(0.8);
      const settled =
        state.offset.length() < 0.01 &&
        Math.abs(state.targetYaw) < 0.005 &&
        Math.abs(state.targetPitch) < 0.005;
      if (settled) {
        state.returning = false;
        state.memoryView = true;
      }
    }

    const lookK = 1 - Math.exp(-dt * 10);
    state.yaw += (state.targetYaw - state.yaw) * lookK;
    // Development only: where the camera is looking, for recording demos (scripts/record-demo.mjs).
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { __againLook?: { yaw: number; target: number } }).__againLook = {
        yaw: state.yaw,
        target: state.targetYaw,
      };
    }
    state.pitch += (state.targetPitch - state.pitch) * lookK;

    _yaw.setFromAxisAngle(UP, state.yaw);
    _pitch.setFromAxisAngle(X_AXIS, state.pitch);
    camera.quaternion.copy(base.q).multiply(_yaw).multiply(_pitch);

    // Move on the horizontal plane of where you're looking.
    _fwd.set(0, 0, -1).applyQuaternion(base.q).applyAxisAngle(UP, state.yaw);
    _fwd.y = 0;
    _fwd.normalize();
    _right.crossVectors(_fwd, UP).normalize();

    let ix = 0;
    let iz = 0;
    for (const code of state.keys) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        ix += dir[0];
        iz += dir[1];
      }
    }
    const desired = _v.set(0, 0, 0).addScaledVector(_fwd, iz).addScaledVector(_right, ix);
    if (desired.lengthSq() > 1) desired.normalize();
    desired.multiplyScalar(MOVE_SPEED);
    state.velocity.lerp(desired, 1 - Math.exp(-dt * 4));

    state.offset.addScaledVector(state.velocity, dt);
    if (state.wheel !== 0) {
      const step = state.wheel * (1 - Math.exp(-dt * 8));
      state.offset.addScaledVector(camera.getWorldDirection(_v), step);
      state.wheel -= step;
      if (Math.abs(state.wheel) < 1e-4) state.wheel = 0;
    }

    const dist = state.offset.length();
    if (dist > ROOM_RADIUS) {
      state.offset.multiplyScalar(1 - ((dist - ROOM_RADIUS) / dist) * clamp01(dt * 6));
    }

    camera.position.copy(base.p).add(state.offset);

    // The first time the view turns well past the photograph, say so.
    if (!beyond.current.reported && !state.returning) {
      const edge = directionEdge(original, photoAspect, camera.getWorldDirection(_v));
      if (edge > BEYOND_EDGE) {
        beyond.current.reported = true;
        beyond.current.onBeyond?.();
      }
    }

    fx.current.worldOpacity = 1;
    fx.current.photoFeather = 1;
    // Returning to the photo lays it back at its real place in the world.
    if (state.returning || state.memoryView) fx.current.photoGlued = false;
    const photoTarget = state.memoryView ? 1 : 0;
    fx.current.photoOpacity +=
      (photoTarget - fx.current.photoOpacity) * (1 - Math.exp(-dt * (state.memoryView ? 2 : 3)));
  });

  return null;
}

/** Put the camera at a local offset from the original camera, facing the same way. */
function placeLocal(
  camera: THREE.Camera,
  base: { q: THREE.Quaternion; p: THREE.Vector3 },
  x: number,
  y: number,
  z: number,
) {
  camera.position.set(x, y, z).applyQuaternion(base.q).add(base.p);
  camera.quaternion.copy(base.q);
}
