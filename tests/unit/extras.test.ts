import { describe, expect, it } from "vitest";
import type { MeshStatus, Object3DProvider } from "@/lib/ai/types";
import { heroScore, selectHeroObjects } from "@/lib/analysis/hero";
import { MemoryObject, parseAnalysis } from "@/lib/analysis/schema";
import { DEMO_ANALYSIS } from "@/lib/demo/analysis";
import {
  advanceExtras,
  type ExtrasDeps,
  readExtras,
  startExtras,
  toPublicExtras,
} from "@/lib/pipeline/extras";
import { MemoryStore } from "@/lib/store";

const obj = (over: Partial<ReturnType<typeof MemoryObject.parse>>) =>
  MemoryObject.parse({ id: "x", label: "x", bbox: [0.1, 0.1, 0.3, 0.3], ...over });

describe("hero object selection", () => {
  it("scores importance, interaction and feasibility", () => {
    const cake = obj({ importance: 0.9, interactionPotential: 0.81, meshFeasibility: 0.94 });
    const curtain = obj({ importance: 0.2, interactionPotential: 0.08, meshFeasibility: 0.42 });
    expect(heroScore(cake)).toBeCloseTo(0.9 * 0.4 + 0.81 * 0.35 + 0.94 * 0.25);
    expect(selectHeroObjects([curtain, cake]).map((o) => o.id)).toEqual([cake.id]);
  });

  it("takes at most three, best first, and skips inferred, tiny or preserved objects", () => {
    const good = (id: string, s: number) =>
      obj({
        id,
        importance: s,
        interactionPotential: s,
        meshFeasibility: s,
        recommendedRepresentation: "mesh",
      });
    const picked = selectHeroObjects([
      good("a", 0.7),
      good("b", 0.95),
      good("c", 0.8),
      good("d", 0.9),
      { ...good("inferred", 1), provenance: "inferred" },
      { ...good("tiny", 1), bbox: [0.1, 0.1, 0.14, 0.14] as const },
      { ...good("portrait", 1), recommendedRepresentation: "preserve" },
    ]);
    expect(picked.map((o) => o.id)).toEqual(["b", "d", "c"]);
  });

  it("leaves big furniture and unrecommended objects in the splat", () => {
    const strong = { importance: 0.85, interactionPotential: 0.85, meshFeasibility: 0.85 };
    const fair = { importance: 0.7, interactionPotential: 0.7, meshFeasibility: 0.7 };
    expect(
      selectHeroObjects([
        obj({
          id: "table",
          ...strong,
          recommendedRepresentation: "mesh",
          bbox: [0.2, 0.6, 0.8, 1],
        }),
        obj({ id: "chair", ...fair, recommendedRepresentation: "splat" }),
        obj({ id: "radio", ...strong, recommendedRepresentation: "splat" }),
        obj({ id: "lamp", ...fair, recommendedRepresentation: "mesh" }),
      ]).map((o) => o.id),
    ).toEqual(["radio", "lamp"]);
  });

  it("picks the kettle in the demo room", () => {
    expect(selectHeroObjects(DEMO_ANALYSIS.objects).map((o) => o.id)).toEqual(["blue-kettle"]);
  });
});

describe("analysis parsing", () => {
  it("reads JSON out of a fenced reply, clamps numbers and drops bad boxes", () => {
    const a = parseAnalysis(
      `Here you go:\n\`\`\`json\n${JSON.stringify({
        sceneType: "kitchen",
        objects: [
          { id: "radio", label: "radio", bbox: [0.5, 0.5, 0.2, 0.2], importance: 3 },
          { id: "void", label: "nothing", bbox: [0.4, 0.4, 0.4, 0.4] },
        ],
      })}\n\`\`\``,
    );
    expect(a.sceneType).toBe("kitchen");
    expect(a.objects[0].bbox).toEqual([0.2, 0.2, 0.5, 0.5]);
    expect(a.objects[0].importance).toBe(1);
    expect(a.objects[1].bbox).toBeUndefined();
    expect(a.audio.globalAmbience).toEqual([]);
  });
});

function deps(over: Partial<ExtrasDeps> = {}): ExtrasDeps {
  let meshPolls = 0;
  const object3d: Object3DProvider = {
    submit: async () => "handle",
    poll: async (): Promise<MeshStatus> =>
      ++meshPolls < 2
        ? { state: "pending" }
        : { state: "succeeded", glbUrl: "https://cdn/kettle.glb" },
  };
  return {
    store: new MemoryStore(),
    vision: { analyze: async () => structuredClone(DEMO_ANALYSIS) },
    segment: { refineBox: async (_u, _l, hint) => hint },
    object3d,
    audio: { generate: async ({ loop }) => (loop ? "https://cdn/sound.mp3" : "x") },
    storage: { upload: async (_b, _t, name) => `https://cdn/${name}` },
    crop: async () => new Uint8Array(4),
    ...over,
  };
}

describe("extras pipeline", () => {
  it("analyses, plans, makes sounds, then finishes the mesh on a later poll", async () => {
    const d = deps();
    await startExtras(d.store, "job", { photoUrl: "https://cdn/photo.jpg", share: false });

    const first = toPublicExtras((await advanceExtras("job", d)) ?? fail());
    expect(first.scene?.sceneType).toBe("bedroom");
    expect(first.objects).toMatchObject([{ id: "blue-kettle", state: "running" }]);
    expect(first.sounds.map((s) => [s.kind, s.state])).toEqual([
      ["ambient", "done"],
      ["positional", "done"],
    ]);
    expect(first.sounds[1].bbox).toBeDefined();
    expect(first.done).toBe(false);

    await advanceExtras("job", d); // mesh still pending
    const last = toPublicExtras((await advanceExtras("job", d)) ?? fail());
    expect(last.objects[0]).toMatchObject({ state: "done", glbUrl: "https://cdn/kettle.glb" });
    expect(last.done).toBe(true);
  });

  it("a failing provider fails only its own step", async () => {
    const d = deps({
      audio: {
        generate: async () => {
          throw new Error("ElevenLabs down");
        },
      },
    });
    await startExtras(d.store, "job", { photoUrl: "https://cdn/photo.jpg", share: false });
    const x = toPublicExtras((await advanceExtras("job", d)) ?? fail());
    expect(x.sounds.every((s) => s.state === "failed")).toBe(true);
    expect(x.objects[0].state).toBe("running");
  });

  it("without a photo URL or providers, everything is skipped (and done)", async () => {
    const d = deps({ vision: null, object3d: null, audio: null });
    await startExtras(d.store, "a", { photoUrl: null, share: false });
    expect(toPublicExtras((await advanceExtras("a", d)) ?? fail()).done).toBe(true);
    await startExtras(d.store, "b", { photoUrl: "https://cdn/p.jpg", share: false });
    expect(toPublicExtras((await advanceExtras("b", d)) ?? fail())).toMatchObject({
      done: true,
      objects: [],
    });
  });

  it("never runs the same step twice at once", async () => {
    let analyses = 0;
    const d = deps({
      vision: {
        analyze: async () => {
          analyses++;
          await new Promise((r) => setTimeout(r, 20));
          return structuredClone(DEMO_ANALYSIS);
        },
      },
    });
    await startExtras(d.store, "job", { photoUrl: "https://cdn/photo.jpg", share: false });
    await Promise.all([advanceExtras("job", d), advanceExtras("job", d), advanceExtras("job", d)]);
    expect(analyses).toBe(1);
    expect((await readExtras(d.store, "job"))?.analysis.state).toBe("done");
  });
});

function fail(): never {
  throw new Error("expected extras");
}

describe("gemini boxes", () => {
  it("converts box_2d [ymin, xmin, ymax, xmax] on 0-1000 to normalized bbox", async () => {
    const { convertBoxes } = await import("@/lib/ai/providers/real/gemini");
    const out = JSON.parse(
      convertBoxes(
        JSON.stringify({ objects: [{ id: "lamp", label: "lamp", box_2d: [100, 200, 500, 400] }] }),
      ),
    );
    expect(out.objects[0].bbox).toEqual([0.2, 0.1, 0.4, 0.5]);
    expect(out.objects[0].box_2d).toBeUndefined();
  });
});

describe("photo layers", () => {
  it("plans people with boxes and flat things marked preserve", async () => {
    const { planLayers } = await import("@/lib/pipeline/extras");
    const analysis = parseAnalysis(
      JSON.stringify({
        objects: [
          {
            id: "portrait",
            label: "oval portrait",
            bbox: [0.2, 0.1, 0.3, 0.3],
            recommendedRepresentation: "preserve",
          },
          {
            id: "lamp",
            label: "lamp",
            bbox: [0.4, 0.4, 0.6, 0.8],
            recommendedRepresentation: "mesh",
          },
          {
            id: "guess",
            label: "photo",
            bbox: [0.7, 0.1, 0.8, 0.2],
            recommendedRepresentation: "preserve",
            provenance: "inferred",
          },
        ],
        people: [
          { id: "p1", description: "figure", bbox: [0.2, 0.3, 0.4, 0.8], confidence: 0.9 },
          { id: "p2", description: "blurry figure", bbox: [0.8, 0.3, 0.9, 0.8], confidence: 0.3 },
          { id: "p3", description: "no box", confidence: 0.9 },
        ],
      }),
    );
    expect(planLayers(analysis).map((l) => [l.id, l.kind])).toEqual([
      ["layer-p1", "person"],
      ["layer-portrait", "flat"],
    ]);
  });

  it("Gemini boxes for people are converted too", async () => {
    const { convertBoxes } = await import("@/lib/ai/providers/real/gemini");
    const out = JSON.parse(
      convertBoxes(JSON.stringify({ people: [{ id: "p", box_2d: [100, 200, 900, 400] }] })),
    );
    expect(out.people[0].bbox).toEqual([0.2, 0.1, 0.4, 0.9]);
  });
});
