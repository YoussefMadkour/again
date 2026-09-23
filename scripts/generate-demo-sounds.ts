// Generates the demo memory's sounds with ElevenLabs into public/demo/audio (spends credits:
// 40 per second, ~840 total). Usage: tsx --env-file=.env.local scripts/generate-demo-sounds.ts
import { mkdir, writeFile } from "node:fs/promises";
import { ElevenLabsAudioProvider } from "../lib/ai/providers/real/elevenlabs";
import { DEMO_ANALYSIS } from "../lib/demo/analysis";
import { SOUND_BUDGET } from "../lib/pipeline/extras";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY missing");

let next = "";
const storage = {
  async upload(bytes: Uint8Array<ArrayBuffer>) {
    await mkdir("public/demo/audio", { recursive: true });
    await writeFile(`public/demo/audio/${next}.mp3`, bytes);
    return `/demo/audio/${next}.mp3`;
  },
};
const audio = new ElevenLabsAudioProvider(key, storage);

const jobs = [
  {
    name: "ambient",
    prompt: DEMO_ANALYSIS.audio.globalAmbience[0].prompt,
    seconds: SOUND_BUDGET.ambientSeconds,
  },
  {
    name: "window",
    prompt: DEMO_ANALYSIS.audio.positionalSources[0].prompt,
    seconds: SOUND_BUDGET.positionalSeconds,
  },
];
for (const job of jobs) {
  next = job.name;
  console.log(
    await audio.generate({ prompt: job.prompt, durationSeconds: job.seconds, loop: true }),
  );
}
