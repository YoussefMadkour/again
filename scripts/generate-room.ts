// Makes a world from several photographs of one room (Marble's multi-image input) and adds it
// to the gallery. The first photo is the one you walk in through. Spends World Labs credits
// (marble-1.1: 1,580). Usage:
//   tsx --env-file=.env.local scripts/generate-room.ts <main.jpg> <other.jpg> [more.jpg...]
// Then: scripts/extras.ts <gallery_id> (analysis, objects, sound), gallery.ts describe/original.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { FalStorage } from "../lib/ai/providers/real/fal";
import { WorldLabsProvider } from "../lib/ai/providers/real/worldlabs";
import { addToGallery } from "../lib/gallery";
import { getStore } from "../lib/store";

const args = process.argv.slice(2);
// --world <id>: add a multi-image world already made (from this main photo) to the gallery.
const existing = args.includes("--world") ? args[args.indexOf("--world") + 1] : undefined;
const [main, ...others] = args.filter((a, i) => a !== "--world" && args[i - 1] !== "--world");
const key = process.env.WORLDLABS_API_KEY;
if (!main || (others.length === 0 && !existing) || !key) {
  throw new Error("usage: generate-room.ts <main> <other> [more...] (needs WORLDLABS_API_KEY)");
}
const ext = (f: string) => extname(f).slice(1).replace("jpeg", "jpg");
const provider = new WorldLabsProvider(key, process.env.WORLDLABS_MODEL || "marble-1.1");
// Multi-image worlds keep their photos private: the main one is hosted on fal's CDN for the
// gallery and the walk-in.
const falKey = process.env.FAL_KEY;
if (!falKey) throw new Error("FAL_KEY is needed to host the main photograph");
const photoUrl = await new FalStorage(falKey).upload(
  new Uint8Array(await readFile(main)),
  ext(main) === "png" ? "image/png" : "image/jpeg",
  `room-${Date.now()}.${ext(main)}`,
);
const { jobId } = existing
  ? { jobId: `world_${existing}` }
  : await provider.create({
      image: { bytes: new Uint8Array(await readFile(main)), extension: ext(main) },
      extraViews: await Promise.all(
        others.map(async (f) => ({ bytes: new Uint8Array(await readFile(f)), extension: ext(f) })),
      ),
      displayName: "again-room",
    });
console.log("job", jobId);
const started = Date.now();
for (;;) {
  if (!existing) await new Promise((r) => setTimeout(r, 15_000));
  const status = await provider.getStatus(jobId);
  const s = Math.round((Date.now() - started) / 1000);
  if (status.state === "pending") {
    console.log(`${s}s ${status.progress ?? "pending"}`);
    continue;
  }
  if (status.state === "failed") throw new Error(`failed: ${status.error}`);
  const entry = await addToGallery(getStore(), { ...status.result, sourcePhotoUrl: photoUrl });
  console.log(
    `${s}s done`,
    entry ? `gallery ${entry.id} → /?memory=${entry.id}` : "no source photo",
  );
  break;
}
