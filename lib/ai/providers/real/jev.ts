/**
 * Jev (TypeSafe's System One model): fast, calibrated judgments over text. It never sees the
 * photograph, only the vision model's description of it, and it doesn't generate anything:
 * it decides. Code keeps the arithmetic (object size, thresholds) and the policy.
 */
import type { Judge, ObjectDecision } from "@/lib/ai/types";
import type { MemoryAnalysis } from "@/lib/analysis/schema";

const API = "https://api.typesafe.ai/v1/systemone";

type Answer =
  | { choice: string; probabilities: Record<string, number>; confidence: number }
  | { score: number; confidence: number }
  | { noul: number };

export class JevJudge implements Judge {
  constructor(
    private readonly key: string,
    private readonly model = "jev-latest",
  ) {}

  private async ask(state: unknown, questions: Record<string, unknown>) {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, state, questions }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { answers?: Record<string, Answer> };
    if (!res.ok || !json.answers) throw new Error(`Jev → ${res.status}`);
    return json.answers;
  }

  /** For each object: 3D object, photo layer, or part of the world, and how much it matters. */
  async representations(analysis: MemoryAnalysis): Promise<ObjectDecision[]> {
    const objects = analysis.objects.map((o) => ({
      label: o.label,
      description: o.description,
      size: o.bbox ? sizeInFrame(o.bbox) : "unknown size",
    }));
    const state = {
      scene: {
        type: analysis.sceneType,
        era: analysis.estimatedEra ?? "unknown",
        description: analysis.description,
      },
      objects,
    };
    const questions: Record<string, unknown> = {};
    objects.forEach((_, i) => {
      questions[`rep_${i}`] = {
        type: "choice",
        instructions: `How should \`objects[${i}]\` be represented in a walkable 3D reconstruction of this photograph?`,
        criteria: {
          object3d:
            "A compact, solid, free-standing object a visitor could pick up or walk around, worth making into its own 3D model: a lamp, vase, radio, toy, cake, clock, kettle.",
          photo:
            "A flat thing whose exact pixels matter and must not be re-imagined: a photograph, portrait, painting, poster, calendar, page, sign or text.",
          world:
            "Part of the room itself, or too large, soft, thin or structural to separate out: furniture, beds, tables, curtains, rugs, walls, windows, doors, light fixtures, clutter.",
        },
      };
      questions[`meaning_${i}`] = {
        type: "score",
        instructions: `How much does \`objects[${i}]\` matter to this particular memory, as something the people in it would remember?`,
        criteria: [
          "Background: incidental, anyone's room would have it",
          "Part of the setting: gives the place its character",
          "Personal: clearly belongs to these people's life",
          "Central: the photograph is partly about this thing",
        ],
      };
    });
    const answers = await this.ask(state, questions);
    return analysis.objects.map((o, i) => {
      const rep = answers[`rep_${i}`] as Extract<Answer, { choice: string }> | undefined;
      const meaning = answers[`meaning_${i}`] as Extract<Answer, { score: number }> | undefined;
      return {
        id: o.id,
        representation: (rep?.choice ?? "world") as ObjectDecision["representation"],
        confidence: rep?.confidence ?? 0,
        // 0..3 on the levels above, normalized to 0..1.
        meaning: meaning ? meaning.score / 3 : 0,
      };
    });
  }

  /** Probability each sound prompt would contain an individual human voice. */
  async voices(prompts: string[]): Promise<number[]> {
    if (prompts.length === 0) return [];
    const answers = await this.ask(
      { prompts },
      Object.fromEntries(
        prompts.map((_, i) => [
          `v${i}`,
          {
            type: "noul",
            instructions: `Would the sound described in \`prompts[${i}]\` contain an identifiable individual human voice: speaking, singing, humming, or a person's name being said?`,
            criteria: {
              true: "One particular person's voice can be heard (a speaker, singer, announcer, hummer).",
              false:
                "No individual voice: ambience, objects, nature, music without vocals, or an indistinct crowd murmur.",
            },
          },
        ]),
      ),
    );
    return prompts.map((_, i) => (answers[`v${i}`] as { noul: number } | undefined)?.noul ?? 1);
  }

  /** Reasons a memory should be reviewed before appearing in the public gallery (empty = fine). */
  async sensitivity(analysis: MemoryAnalysis): Promise<string[]> {
    const scene = [
      analysis.description,
      ...analysis.people.map((p) => p.description),
      ...analysis.objects.map((o) => `${o.label}: ${o.description}`),
    ].join("\n");
    const checks = {
      child_undressed: "Does `scene` show a child who is undressed or bathing?",
      nudity: "Does `scene` show an adult who is nude or in underwear?",
      medical: "Does `scene` show someone ill, injured, in medical care, or dying?",
      private_info:
        "Does `scene` include readable personal details such as a full name, home address, or phone number?",
    };
    const answers = await this.ask(
      { scene },
      Object.fromEntries(
        Object.entries(checks).map(([k, instructions]) => [k, { type: "noul", instructions }]),
      ),
    );
    return Object.keys(checks).filter((k) => ((answers[k] as { noul: number })?.noul ?? 0) > 0.5);
  }
}

/** Size is arithmetic: computed here and handed to the model as a named bucket. */
export function sizeInFrame([x0, y0, x1, y1]: readonly number[]) {
  const a = (x1 - x0) * (y1 - y0);
  if (a < 0.01) return "small in the frame";
  if (a < 0.05) return "medium in the frame";
  if (a < 0.12) return "large in the frame";
  return "very large in the frame";
}
