import type { AudioGenerationInput, AudioProvider, FileStorage } from "@/lib/ai/types";
import { randomId } from "@/lib/id";

/**
 * ElevenLabs sound effects: ambience beds (seamless loops) and object sounds. No voices.
 * Billed at 40 credits per second of audio, so durations are kept short.
 */
export class ElevenLabsAudioProvider implements AudioProvider {
  constructor(
    private readonly apiKey: string,
    private readonly storage: FileStorage,
  ) {}

  async generate({ prompt, durationSeconds, loop }: AudioGenerationInput): Promise<string> {
    const res = await fetch(
      "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: prompt,
          duration_seconds: durationSeconds,
          loop,
          prompt_influence: 0.45,
          model_id: "eleven_text_to_sound_v2",
        }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs → ${res.status}: ${body.slice(0, 200)}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return this.storage.upload(bytes, "audio/mpeg", `sound-${randomId(8)}.mp3`);
  }
}
