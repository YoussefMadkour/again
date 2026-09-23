import type { BoundingBox } from "@/lib/analysis/schema";
import type { PublicExtras } from "@/lib/pipeline/extras";
import { DEMO_ANALYSIS } from "./analysis";

const find = (id: string) => {
  const o = DEMO_ANALYSIS.objects.find((x) => x.id === id);
  if (!o?.bbox) throw new Error(`demo object ${id} missing`);
  return { ...o, bbox: o.bbox as BoundingBox };
};

const kettle = find("blue-kettle");
const window = find("round-window");

/** The demo memory's objects and sound, pre-generated (see scripts/generate-demo-sounds.ts). */
export const DEMO_EXTRAS: PublicExtras = {
  done: true,
  scene: {
    sceneType: DEMO_ANALYSIS.sceneType,
    description: DEMO_ANALYSIS.description,
    mood: DEMO_ANALYSIS.mood,
    uncertainties: DEMO_ANALYSIS.uncertainties,
  },
  objects: [
    {
      id: kettle.id,
      label: kettle.label,
      description: kettle.description,
      bbox: kettle.bbox,
      glbUrl: "/demo/object.glb",
      state: "done",
    },
  ],
  sounds: [
    {
      id: "demo-ambient",
      kind: "ambient",
      description: DEMO_ANALYSIS.audio.globalAmbience[0].description,
      url: "/demo/audio/ambient.mp3",
      state: "done",
    },
    {
      id: "demo-window",
      kind: "positional",
      description: DEMO_ANALYSIS.audio.positionalSources[0].description,
      objectId: window.id,
      bbox: window.bbox,
      url: "/demo/audio/window.mp3",
      state: "done",
    },
  ],
};
