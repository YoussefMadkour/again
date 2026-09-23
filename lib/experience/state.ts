/**
 * The whole product lives on one screen. What changes is this state, never the route.
 */
export type ExperienceState =
  | "idle"
  /** A photo is chosen but needs an access code or the visitor's own key. */
  | "unlocking"
  | "uploading"
  | "analyzing"
  | "generating"
  | "ready"
  | "entering"
  | "exploring"
  | "error";

export type ExperienceEvent =
  | { type: "UNLOCK" }
  | { type: "UPLOAD" }
  | { type: "UPLOADED" }
  | { type: "DENIED" }
  | { type: "ANALYZED" }
  | { type: "GENERATED" }
  | { type: "DEMO" }
  | { type: "STEP_INSIDE" }
  | { type: "ENTERED" }
  | { type: "FAIL" }
  | { type: "RESET" };

const transitions: Record<
  ExperienceState,
  Partial<Record<ExperienceEvent["type"], ExperienceState>>
> = {
  idle: { UNLOCK: "unlocking", UPLOAD: "uploading", DEMO: "ready" },
  unlocking: { UPLOAD: "uploading", RESET: "idle" },
  // No scene analysis yet (Milestone 3), so an upload goes straight to generating.
  // DENIED: the code or key was refused, so ask again with the photo still on screen.
  uploading: { UPLOADED: "generating", DENIED: "unlocking", FAIL: "error", RESET: "idle" },
  analyzing: { ANALYZED: "generating", FAIL: "error" },
  generating: { GENERATED: "ready", FAIL: "error", RESET: "idle" },
  ready: { STEP_INSIDE: "entering", RESET: "idle" },
  entering: { ENTERED: "exploring", FAIL: "error" },
  exploring: { RESET: "idle" },
  error: { RESET: "idle" },
};

/** Unknown events for the current state are ignored rather than thrown. */
export function nextState(state: ExperienceState, event: ExperienceEvent): ExperienceState {
  return transitions[state][event.type] ?? state;
}
