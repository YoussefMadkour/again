import type { VisionProvider } from "@/lib/ai/types";
import { type MemoryAnalysis, parseAnalysis } from "@/lib/analysis/schema";
import { fetchImage } from "@/lib/pipeline/crop";
import { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from "./vision-prompt";

const API = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Gemini reads the photo directly (inline bytes, so the photo needs no public URL) and is
 * trained to localize objects. It boxes best in its native format, [ymin, xmin, ymax, xmax] on
 * a 0-1000 grid, so we ask for that and convert.
 */
const GEMINI_BOXES = `

Boxes: instead of "bbox", give each object a "box_2d": [ymin, xmin, ymax, xmax], integers 0-1000 relative to the image (0,0 top-left).`;

export class GeminiVisionProvider implements VisionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async analyze(photoUrl: string): Promise<MemoryAnalysis> {
    const bytes = await fetchImage(photoUrl);
    const res = await fetch(`${API}/${this.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: VISION_SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: sniffType(bytes), data: bytes.toString("base64") } },
              { text: VISION_USER_PROMPT + GEMINI_BOXES },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { message?: string };
    };
    if (!res.ok)
      throw new Error(`Gemini → ${res.status}: ${json.error?.message ?? ""}`.slice(0, 300));
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return parseAnalysis(convertBoxes(text));
  }
}

/** box_2d [ymin, xmin, ymax, xmax] 0-1000 → bbox [x0, y0, x1, y1] 0-1. */
export function convertBoxes(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return text;
  const raw = JSON.parse(text.slice(start, end + 1)) as { objects?: Record<string, unknown>[] };
  for (const o of raw.objects ?? []) {
    const box = o.box_2d;
    if (Array.isArray(box) && box.length === 4 && o.bbox === undefined) {
      const [ymin, xmin, ymax, xmax] = box.map(Number);
      o.bbox = [xmin / 1000, ymin / 1000, xmax / 1000, ymax / 1000];
    }
    delete o.box_2d;
  }
  return JSON.stringify(raw);
}

function sniffType(bytes: Buffer) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "image/jpeg";
}
