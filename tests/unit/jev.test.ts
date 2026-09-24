import { describe, expect, it } from "vitest";
import { sizeInFrame } from "@/lib/ai/providers/real/jev";
import type { Judge, ObjectDecision } from "@/lib/ai/types";
import { selectHeroObjects } from "@/lib/analysis/hero";
import { parseAnalysis } from "@/lib/analysis/schema";
import { DEMO_ANALYSIS } from "@/lib/demo/analysis";
import { addToGallery, approveGalleryEntry, galleryCards, getGalleryEntry } from "@/lib/gallery";
import { advanceExtras, planLayers, readExtras, startExtras } from "@/lib/pipeline/extras";
import { MemoryStore } from "@/lib/store";

const analysis = parseAnalysis(
  JSON.stringify({
    objects: [
      {
        id: "table",
        label: "dining table",
        bbox: [0.2, 0.6, 0.8, 1],
        recommendedRepresentation: "mesh",
      },
      {
        id: "lamp",
        label: "table lamp",
        bbox: [0.45, 0.45, 0.6, 0.78],
        recommendedRepresentation: "mesh",
      },
      {
        id: "radio",
        label: "radio",
        bbox: [0.1, 0.5, 0.2, 0.6],
        recommendedRepresentation: "splat",
      },
      {
        id: "bulb",
        label: "light bulb",
        bbox: [0.39, 0, 0.42, 0.2],
        recommendedRepresentation: "mesh",
      },
      {
        id: "portrait",
        label: "portrait",
        bbox: [0.7, 0.1, 0.8, 0.3],
        recommendedRepresentation: "splat",
      },
    ],
  }),
);

const decide = (
  id: string,
  representation: ObjectDecision["representation"],
  confidence: number,
  meaning: number,
) => ({
  id,
  representation,
  confidence,
  meaning,
});

describe("Jev decisions", () => {
  const decisions = [
    decide("table", "world", 0.99, 0.4),
    decide("lamp", "object3d", 0.99, 0.3),
    decide("radio", "object3d", 0.9, 0.9),
    decide("bulb", "object3d", 0.3, 0.1),
    decide("portrait", "photo", 0.9, 0.8),
  ];

  it("choose 3D objects, confidently called, most meaningful first", () => {
    // The table is world; the bulb's call is too uncertain; the radio matters more than the lamp.
    expect(selectHeroObjects(analysis.objects, decisions).map((o) => o.id)).toEqual([
      "radio",
      "lamp",
    ]);
  });

  it("still respect the size rules (no huge meshes, whatever the call)", () => {
    const wrong = decisions.map((d) =>
      d.id === "table" ? { ...d, representation: "object3d" as const } : d,
    );
    expect(selectHeroObjects(analysis.objects, wrong).map((o) => o.id)).not.toContain("table");
  });

  it("decide photo layers, overriding the vision model's own label", () => {
    expect(planLayers(analysis, decisions).map((l) => l.id)).toEqual(["layer-portrait"]);
    expect(planLayers(analysis).map((l) => l.id)).toEqual([]); // Gemini called it splat
  });

  it("buckets size in code, not in the model", () => {
    expect(sizeInFrame([0, 0, 0.05, 0.05])).toBe("small in the frame");
    expect(sizeInFrame([0.2, 0.6, 0.8, 1])).toBe("very large in the frame");
  });
});

const judge = (voices: number[] = [], sensitive: string[] = []): Judge => ({
  representations: async (a) => a.objects.map((o) => decide(o.id, "world", 0.9, 0.5)),
  voices: async () => voices,
  sensitivity: async () => sensitive,
});

describe("voice guard", () => {
  it("drops sounds that would contain a voice, before they're paid for", async () => {
    const store = new MemoryStore();
    const made: string[] = [];
    await startExtras(store, "job", { photoUrl: "https://cdn/p.jpg", share: false });
    await advanceExtras("job", {
      store,
      vision: { analyze: async () => structuredClone(DEMO_ANALYSIS) },
      segment: null,
      object3d: null,
      audio: {
        generate: async ({ prompt }) => {
          made.push(prompt);
          return "https://cdn/s.mp3";
        },
      },
      storage: null,
      judge: judge([0.05, 0.93]),
      crop: async () => new Uint8Array(),
    });
    const x = await readExtras(store, "job");
    expect(x?.sounds?.map((s) => s.state)).toEqual(["done", "skipped"]);
    expect(x?.sounds?.[1].error).toMatch(/voice/);
    expect(made).toHaveLength(1);
  });
});

describe("gallery hold", () => {
  const world = {
    splatUrl: "https://cdn/w.spz",
    format: "spz" as const,
    metricScale: 1,
    sourcePhotoUrl: "https://cdn/p.jpg",
    metadata: { provider: "worldlabs", worldId: "w1", generatedAt: "2026-09-24" },
  };

  it("keeps held memories out of the gallery and unopenable until approved", async () => {
    const store = new MemoryStore();
    const entry = await addToGallery(store, world, {
      held: true,
      heldReasons: ["child_undressed"],
    });
    expect(await galleryCards(store)).toEqual([]);
    expect(await getGalleryEntry(store, entry?.id ?? "")).toBeNull();
    await approveGalleryEntry(store, entry?.id ?? "");
    expect(await galleryCards(store)).toHaveLength(1);
  });
});
