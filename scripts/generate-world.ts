// Generate a world from a local photo with the real World Labs provider, and print the result.
// Usage: pnpm tsx --env-file=.env.local scripts/generate-world.ts <photo.jpg> [model]
// Costs credits: marble-1.0-draft 230, marble-1.1 1,580.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { WorldLabsProvider } from "../lib/ai/providers/real/worldlabs";

const [photo, model = "marble-1.0-draft"] = process.argv.slice(2);
const key = process.env.WORLDLABS_API_KEY;
if (!photo || !key)
  throw new Error("usage: generate-world.ts <photo> [model] (needs WORLDLABS_API_KEY)");

const provider = new WorldLabsProvider(key, model);
const bytes = new Uint8Array(await readFile(photo));
const { jobId } = await provider.create({
  image: { bytes, extension: extname(photo).slice(1).replace("jpeg", "jpg") },
  displayName: "again-dev",
});
console.log("job", jobId, "model", model);

const started = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 10_000));
  const status = await provider.getStatus(jobId);
  const s = Math.round((Date.now() - started) / 1000);
  if (status.state === "pending") {
    console.log(`${s}s pending ${status.progress ?? ""}`);
    continue;
  }
  console.log(`${s}s`, JSON.stringify(status, null, 2));
  break;
}
