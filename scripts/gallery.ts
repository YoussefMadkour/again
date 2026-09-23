// Curate the public gallery.
//   tsx --env-file=.env.local scripts/gallery.ts list
//   tsx --env-file=.env.local scripts/gallery.ts add <world_id>     (a world on your World Labs key)
//   tsx --env-file=.env.local scripts/gallery.ts remove <gallery_id>
// Uses Upstash Redis when KV_REST_API_URL/TOKEN are set, otherwise .data/store.json.
import { WorldLabsProvider } from "../lib/ai/providers/real/worldlabs";
import { addToGallery, listGallery, removeFromGallery } from "../lib/gallery";
import { getStore } from "../lib/store";

const [command, arg] = process.argv.slice(2);
const store = getStore();

if (command === "list") {
  for (const e of await listGallery(store)) {
    console.log(
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
} else if (command === "remove" && arg) {
  console.log((await removeFromGallery(store, arg)) ? "removed" : "not found");
} else {
  console.log("usage: gallery.ts list | add <world_id> | remove <gallery_id>");
  process.exit(1);
}
