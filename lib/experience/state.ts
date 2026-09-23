/**
 * The whole product lives on one screen. What changes is this state, never the route.
 */
export type ExperienceState =
  | "idle"
  | "uploading"
  | "analyzing"
  | "generating"
  | "ready"
  | "entering"
  | "exploring"
  | "error";

export type ExperienceEvent =
  | { type: "UPLOAD" }
  | { type: "UPLOADED" }
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
  idle: { UPLOAD: "uploading", DEMO: "ready" },
  uploading: { UPLOADED: "analyzing", FAIL: "error" },
  analyzing: { ANALYZED: "generating", FAIL: "error" },
  generating: { GENERATED: "ready", FAIL: "error" },
  ready: { STEP_INSIDE: "entering", RESET: "idle" },
  entering: { ENTERED: "exploring", FAIL: "error" },
  exploring: { RESET: "idle" },
  error: { RESET: "idle" },
};

/** Unknown events for the current state are ignored rather than thrown. */
export function nextState(state: ExperienceState, event: ExperienceEvent): ExperienceState {
  return transitions[state][event.type] ?? state;
}
