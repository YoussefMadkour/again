import { describe, expect, it } from "vitest";
import type { PersonModelProvider, PersonModelStatus } from "@/lib/ai/types";
import { parseAnalysis } from "@/lib/analysis/schema";
import {
  advanceExtras,
  type ExtrasDeps,
  readExtras,
  startExtras,
  toPublicExtras,
} from "@/lib/pipeline/extras";
import { fitShapeToBody } from "@/lib/pipeline/hybrid";
import { matchPerson } from "@/lib/pipeline/person";
import { MemoryStore } from "@/lib/store";

const analysis = parseAnalysis(
  JSON.stringify({
    sceneType: "room",
    people: [{ id: "p1", description: "a woman", bbox: [0.3, 0.2, 0.5, 0.9], confidence: 0.9 }],
  }),
);

function deps(person3d: PersonModelProvider | null): ExtrasDeps {
  return {
    store: new MemoryStore(),
    vision: { analyze: async () => structuredClone(analysis) },
    segment: null,
    object3d: null,
    audio: null,
    storage: { upload: async (_b, _t, name) => `https://cdn/${name}` },
    crop: async () => new Uint8Array(4),
    cutout: async () => ({ bytes: new Uint8Array(4), box: [0.28, 0.18, 0.52, 0.92] }),
    person3d,
    fitPerson: async () => ({ bytes: new Uint8Array(4), fov: 44.061 }),
  };
}

describe("people in 3D", () => {
  it("makes a model after the cutout, without holding the flat layer back", async () => {
    let polls = 0;
    const done: PersonModelStatus = {
      state: "succeeded",
      bodyGlbUrl: "https://cdn/body.glb",
      shapeGlbUrl: "https://cdn/shape.glb",
      people: [],
    };
    const d = deps({
      submit: async () => "h",
      poll: async () => (++polls < 2 ? { state: "pending" } : done),
    });
    await startExtras(d.store, "job", { photoUrl: "https://cdn/photo.jpg", share: false });

    const first = toPublicExtras((await advanceExtras("job", d)) ?? fail());
    expect(first.layers?.[0]).toMatchObject({ kind: "person", state: "done" });
    expect(first.layers?.[0].body).toBeUndefined();
    expect(first.done).toBe(false);

    await advanceExtras("job", d); // both models still running
    const last = toPublicExtras((await advanceExtras("job", d)) ?? fail());
    expect(last.layers?.[0].body).toMatchObject({ fov: 44.06 });
    expect(last.layers?.[0].body?.url).toMatch(/^https:\/\/cdn\/person-layer-p1-/);
    expect(last.done).toBe(true);
  });

  it("a failed model leaves the flat layer, and the memory still finishes", async () => {
    const d = deps({
      submit: async () => "h",
      poll: async () => ({ state: "failed", error: "gpu on fire" }),
    });
    await startExtras(d.store, "job", { photoUrl: "https://cdn/photo.jpg", share: false });
    await advanceExtras("job", d);
    const x = toPublicExtras((await advanceExtras("job", d)) ?? fail());
    expect(x.layers?.[0]).toMatchObject({ state: "done", url: expect.any(String) });
    expect(x.layers?.[0].body).toBeUndefined();
    expect(x.done).toBe(true);
  });

  it("without the provider, it's skipped; layers from before never start paid work", async () => {
    const d = deps(null);
    await startExtras(d.store, "job", { photoUrl: "https://cdn/photo.jpg", share: false });
    expect(toPublicExtras((await advanceExtras("job", d)) ?? fail()).done).toBe(true);

    const legacy = deps({ submit: async () => fail(), poll: async () => fail() });
    await startExtras(legacy.store, "old", { photoUrl: "https://cdn/photo.jpg", share: false });
    await advanceExtras("old", legacy);
    const x = await readExtras(legacy.store, "old");
    const layer = x?.layers?.[0];
    if (!x || !layer) return fail();
    delete layer.bodyState; // as stored before this step existed
    layer.state = "done";
    await legacy.store.set("extras:old", x, 60);
    await advanceExtras("old", legacy);
    expect((await readExtras(legacy.store, "old"))?.layers?.[0].bodyState).toBeUndefined();
  });

  it("matches the layer to the detected body with the most overlap", () => {
    const people = [
      { index: 0, bbox: [0, 0, 100, 400] as [number, number, number, number], focalLength: 1 },
      { index: 1, bbox: [300, 100, 500, 450] as [number, number, number, number], focalLength: 1 },
    ];
    expect(matchPerson(people, [0.3, 0.2, 0.5, 0.9], 1000, 500)?.index).toBe(1);
    expect(matchPerson(people, [0.8, 0.1, 0.9, 0.2], 1000, 500)).toBeNull();
  });

  it("recovers the scale, turn and offset between two copies of a shape", () => {
    // A lumpy upright figure, and the same figure scaled 1.2x, turned 20 degrees and moved.
    const shape: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const y = (i / 4000) * 1.6;
      const a = i * 2.399;
      const r = 0.12 + 0.06 * Math.sin(y * 7) + (y > 1.4 ? -0.04 : 0);
      shape.push(r * Math.cos(a) * 1.4, y, r * Math.sin(a));
    }
    const th = (20 * Math.PI) / 180;
    const body = new Float32Array(shape.length);
    for (let i = 0; i < shape.length; i += 3) {
      const [x, y, z] = shape.slice(i, i + 3);
      body[i] = 1.2 * (Math.cos(th) * x + Math.sin(th) * z) + 0.3;
      body[i + 1] = 1.2 * y - 0.5;
      body[i + 2] = 1.2 * (-Math.sin(th) * x + Math.cos(th) * z) - 2;
    }
    const fit = fitShapeToBody(new Float32Array(shape), body);
    expect(fit.scale).toBeCloseTo(1.2, 1);
    expect(fit.translation[0]).toBeCloseTo(0.3, 1);
    expect(fit.translation[2]).toBeCloseTo(-2, 1);
    expect(fit.error).toBeLessThan(0.01);
  });
});

function fail(): never {
  throw new Error("unexpected");
}
