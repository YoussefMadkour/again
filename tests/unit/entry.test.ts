import { describe, expect, it } from "vitest";
import { ENTRY, entryFrame, handoffOffset, photoPlaneHeight } from "@/lib/world/entry";

describe("photo plane geometry", () => {
  it("fills the vertical fov at 1 unit for a 90° camera", () => {
    expect(photoPlaneHeight(90)).toBeCloseTo(2);
  });

  it("pulls the camera back so the plane matches the card height", () => {
    // Card is half the viewport height -> camera sits twice as far from the plane.
    const o = handoffOffset({ dx: 0, dy: 0, height: 450, viewportHeight: 900 }, 60);
    expect(o.z).toBeCloseTo(1);
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(0);
  });

  it("shifts the camera opposite to an off-centre card", () => {
    const o = handoffOffset({ dx: 100, dy: 50, height: 450, viewportHeight: 900 }, 60);
    expect(o.x).toBeLessThan(0);
    expect(o.y).toBeGreaterThan(0);
  });
});

describe("entry choreography", () => {
  it("starts as a crisp photo on black", () => {
    const f = entryFrame(0);
    expect(f.approach).toBe(1);
    expect(f.worldOpacity).toBe(0);
    expect(f.photoOpacity).toBe(1);
    expect(f.photoFeather).toBe(0);
  });

  it("arrives at the original viewpoint with the world visible behind the photo", () => {
    const f = entryFrame(ENTRY.arrive);
    expect(f.approach).toBeCloseTo(0);
    expect(f.worldOpacity).toBeCloseTo(1);
    expect(f.photoOpacity).toBe(1);
  });

  it("ends inside the world with the photo gone", () => {
    const f = entryFrame(ENTRY.duration);
    expect(f.done).toBe(true);
    expect(f.photoOpacity).toBe(0);
    expect(f.push).toBeCloseTo(ENTRY.pushThrough);
  });

  it("never moves the camera backwards", () => {
    let last = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= ENTRY.duration; t += 0.05) {
      const f = entryFrame(t);
      const depth = f.approach - f.push;
      expect(depth).toBeLessThanOrEqual(last + 1e-9);
      last = depth;
    }
  });
});
