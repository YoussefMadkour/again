import { describe, expect, it } from "vitest";
import { nextState } from "@/lib/experience/state";

describe("experience state machine", () => {
  it("walks the full upload flow", () => {
    let s = nextState("idle", { type: "UPLOAD" });
    s = nextState(s, { type: "UPLOADED" });
    s = nextState(s, { type: "ANALYZED" });
    s = nextState(s, { type: "GENERATED" });
    expect(s).toBe("ready");
    s = nextState(s, { type: "STEP_INSIDE" });
    expect(s).toBe("entering");
    expect(nextState(s, { type: "ENTERED" })).toBe("exploring");
  });

  it("demo jumps straight to ready", () => {
    expect(nextState("idle", { type: "DEMO" })).toBe("ready");
  });

  it("ignores events that don't apply", () => {
    expect(nextState("idle", { type: "STEP_INSIDE" })).toBe("idle");
    expect(nextState("exploring", { type: "STEP_INSIDE" })).toBe("exploring");
  });

  it("any pipeline failure lands in error, which can reset", () => {
    expect(nextState("analyzing", { type: "FAIL" })).toBe("error");
    expect(nextState("error", { type: "RESET" })).toBe("idle");
  });
});
