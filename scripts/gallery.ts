// Curate the public gallery.
//   tsx --env-file=.env.local scripts/gallery.ts list
//   tsx --env-file=.env.local scripts/gallery.ts add <world_id>     (a world on your World Labs key)
//   tsx --env-file=.env.local scripts/gallery.ts remove <gallery_id>
//   tsx --env-file=.env.local scripts/gallery.ts approve <gallery_id>   (publish a held memory)
//   tsx --env-file=.env.local scripts/gallery.ts original <gallery_id> <url>
//     (the real photograph behind a restored one: the carousel shows a before/after slider)
// Uses Upstash Redis when KV_REST_API_URL/TOKEN are set, otherwise .data/store.json.
import { WorldLabsProvider } from "../lib/ai/providers/real/worldlabs";
import {
  addToGallery,
  approveGalleryEntry,
  listGallery,
  removeFromGallery,
  setOriginalPhoto,
} from "../lib/gallery";
import { getStore } from "../lib/store";

const [command, arg, arg2] = process.argv.slice(2);
const store = getStore();

if (command === "list") {
  for (const e of await listGallery(store)) {
    console.log(
      e.held ? `HELD (${(e.heldReasons ?? []).join(", ")})` : "public",
      e.id,
      e.createdAt.slice(0, 10),
      e.world.metadata.worldId ?? "",
      e.photoUrl.slice(0, 60),
    );
  }
} else if (command === "add" && arg) {
  const key = process.env.WORLDLABS_API_KEY;
  if (!key) throw new Error("WORLDLABS_API_KEY is needed to read the world");
  const status = await new WorldLabsProvider(key, "marble-1.1").getStatus(`world_${arg}`);
  if (status.state !== "succeeded") throw new Error(`world isn't ready (${status.state})`);
  const entry = await addToGallery(store, status.result);
  console.log(entry ? `added ${entry.id} → /?memory=${entry.id}` : "world has no source photo");
} else if (command === "approve" && arg) {
  console.log((await approveGalleryEntry(store, arg)) ? "approved: now public" : "not found");
} else if (command === "original" && arg && arg2) {
  console.log((await setOriginalPhoto(store, arg, arg2)) ? "original photograph set" : "not found");
} else if (command === "remove" && arg) {
  console.log((await removeFromGallery(store, arg)) ? "removed" : "not found");
} else {
  console.log(
    "usage: gallery.ts list | add <world_id> | approve <gallery_id> | remove <gallery_id> | original <gallery_id> <url>",
  );
  process.exit(1);
}
