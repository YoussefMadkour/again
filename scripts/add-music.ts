// Gives a gallery memory a music track: a quiet, non-positional score under the room's own
// sound (it replaces any it had). Free: the track is already made (e.g. with ElevenLabs Music,
// see docs/PROVIDERS.md). Usage:
//   tsx --env-file=.env.local scripts/add-music.ts <gallery_id> <url> "<description>"
// A /demo/<name>/... url is kept as is by bake-demo.ts.
import { getGalleryEntry, updateGalleryExtras } from "../lib/gallery";
import { readExtras, toPublicExtras } from "../lib/pipeline/extras";
import { getStore } from "../lib/store";

const [galleryId, url, description = "music"] = process.argv.slice(2);
if (!galleryId || !url) throw new Error("usage: add-music.ts <gallery_id> <url> [description]");

const store = getStore();
const entry = await getGalleryEntry(store, galleryId, true);
if (!entry?.jobId) throw new Error(`no gallery entry with extras: ${galleryId}`);
const extras = await readExtras(store, entry.jobId);
if (!extras) throw new Error("this memory has no extras yet");

extras.sounds = [
  ...(extras.sounds ?? []).filter((s) => s.kind !== "music"),
  { id: "music", kind: "music", description, prompt: description, state: "done", url },
];
await store.set(`extras:${entry.jobId}`, extras, 60 * 60 * 24 * 7);
await updateGalleryExtras(store, entry.jobId, toPublicExtras(extras));
console.log("music added to", `/?memory=${galleryId}`);
