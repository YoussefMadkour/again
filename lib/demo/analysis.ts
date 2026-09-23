import type { MemoryAnalysis } from "@/lib/analysis/schema";

/** Hand-written manifest for the demo room (painted bedroom). Mock mode returns it for any photo. */
export const DEMO_ANALYSIS: MemoryAnalysis = {
  sceneType: "bedroom",
  description:
    "A cosy, hand-painted attic bedroom with a round stained-glass window and a made bed.",
  mood: "warm, quiet, storybook",
  environment: {
    type: "interior",
    description: "Attic room under curved wooden beams, pastel walls, afternoon light.",
  },
  objects: [
    {
      id: "blue-kettle",
      label: "blue kettle",
      description: "A small blue enamel kettle on the bedside table.",
      bbox: [0.403, 0.505, 0.452, 0.582],
      visibility: 0.85,
      importance: 0.7,
      interactionPotential: 0.85,
      meshFeasibility: 0.95,
      provenance: "observed",
      recommendedRepresentation: "mesh",
    },
    {
      id: "round-window",
      label: "round stained glass window",
      description: "A large round window with a stained-glass rose pattern.",
      bbox: [0.735, 0.27, 0.985, 0.57],
      visibility: 0.95,
      importance: 0.8,
      interactionPotential: 0.3,
      meshFeasibility: 0.15,
      provenance: "observed",
      recommendedRepresentation: "splat",
    },
    {
      id: "bed",
      label: "bed",
      description: "A wooden bed with a green quilt and patterned pillows.",
      bbox: [0.11, 0.52, 0.7, 1.0],
      visibility: 0.9,
      importance: 0.7,
      interactionPotential: 0.35,
      meshFeasibility: 0.35,
      provenance: "observed",
      recommendedRepresentation: "splat",
    },
    {
      id: "sofa",
      label: "cream sofa",
      description: "A small cream sofa with blue cushions beneath the window.",
      bbox: [0.7, 0.54, 0.97, 0.73],
      visibility: 0.85,
      importance: 0.45,
      interactionPotential: 0.35,
      meshFeasibility: 0.6,
      provenance: "observed",
      recommendedRepresentation: "splat",
    },
    {
      id: "wall-lantern",
      label: "wall lantern",
      description: "A small lantern glowing on the left wall.",
      bbox: [0.022, 0.33, 0.062, 0.445],
      visibility: 0.8,
      importance: 0.35,
      interactionPotential: 0.4,
      meshFeasibility: 0.8,
      provenance: "observed",
      recommendedRepresentation: "splat",
    },
    {
      id: "rug",
      label: "patterned rug",
      description: "A round patterned rug on the floor.",
      bbox: [0.5, 0.74, 0.88, 0.98],
      visibility: 0.7,
      importance: 0.2,
      interactionPotential: 0.08,
      meshFeasibility: 0.2,
      provenance: "observed",
      recommendedRepresentation: "splat",
    },
  ],
  people: [],
  architecture: {
    description: "Curved timber beams, a pitched ceiling, plastered walls.",
    visibleStructures: ["ceiling beams", "round window", "left wall", "back wall"],
    possibleStructures: ["a door behind the viewer", "a staircase down"],
  },
  lighting: {
    description: "Soft daylight through the round window.",
    approximateTime: "afternoon",
  },
  audio: {
    globalAmbience: [
      {
        description: "quiet attic room tone",
        prompt:
          "quiet cosy attic bedroom room tone, faint creak of old wooden beams, very soft distant birdsong outside, calm and warm, no music, no voices",
      },
    ],
    positionalSources: [
      {
        object: "round-window",
        description: "birds and a light breeze at the window",
        prompt:
          "gentle breeze and small birds chirping just outside a slightly open window, soft and close, no music, no voices",
      },
    ],
  },
  worldGenerationPrompt: "A cosy hand-painted attic bedroom with a round stained-glass window.",
  uncertainties: ["what is behind the viewer", "the rest of the house"],
};
