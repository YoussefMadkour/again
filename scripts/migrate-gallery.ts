// Copies the gallery from the local development store (.data/store.json) into the configured
// store (Upstash Redis when KV_REST_API_URL/TOKEN are set), for a deployment. Files that only
// exist on this machine (/api/files/...) are re-uploaded to fal's CDN on the way.
// Usage:
//   vercel env pull .env.production.local
//   tsx --env-file=.env.production.local --env-file=.env.local scripts/migrate-gallery.ts \
//     [--skip id,id] [--dry-run]
// By default the Villa Ephrussi and Monet memories stay behind (their photographs' rights
// aren't confirmed); pass --skip "" to copy everything.
import { readFile } from "node:fs/promises";
import { readLocalFile } from "../lib/ai/providers/local-storage";
import { FalStorage } from "../lib/ai/providers/real/fal";
import type { GalleryEntry } from "../lib/gallery";
import { getStore } from "../lib/store";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const skip = new Set(
  (flag("--skip") ?? "49c478bf6bf1e570,ec4ea1a01b15450d").split(",").filter(Boolean),
);
const dryRun = args.includes("--dry-run");

if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
  throw new Error("no Redis configured (KV_REST_API_URL): this would copy the file onto itself");
}
const key = process.env.FAL_KEY;
if (!key) throw new Error("FAL_KEY is needed to move local files to the CDN");
const cdn = new FalStorage(key);

const local = JSON.parse(await readFile(".data/store.json", "utf8")) as Record<
  string,
  { value: unknown }
>;
const entries = ((local.gallery?.value ?? []) as GalleryEntry[]).filter((e) => !skip.has(e.id));

const moved = new Map<string, string>();
/** Every /api/files/... string in the entry, re-uploaded (JSON round trip keeps it simple). */
async function publicise(entry: GalleryEntry): Promise<GalleryEntry> {
  let json = JSON.stringify(entry);
  for (const url of new Set(json.match(/\/api\/files\/[^"\\]+/g) ?? [])) {
    if (!moved.has(url)) {
      const bytes = await readLocalFile(url);
      if (!bytes) throw new Error(`missing local file ${url}`);
      const type = url.endsWith(".mp3")
        ? "audio/mpeg"
        : url.endsWith(".glb")
          ? "model/gltf-binary"
          : url.endsWith(".png")
            ? "image/png"
            : "image/jpeg";
      const name = url.split("/").pop() as string;
      moved.set(
        url,
        dryRun ? `(cdn) ${name}` : await cdn.upload(new Uint8Array(bytes), type, name),
      );
    }
    json = json.split(url).join(moved.get(url) as string);
  }
  return JSON.parse(json) as GalleryEntry;
}

const out: GalleryEntry[] = [];
for (const e of entries) out.push(await publicise(e));
for (const e of out) {
  console.log(e.held ? "held  " : "public", e.id, e.originalPhotoUrl ? "(with original)" : "");
}
console.log(
  `${moved.size} local file(s) moved to the CDN; skipped: ${[...skip].join(", ") || "none"}`,
);

if (!dryRun) {
  const store = getStore();
  // Merge with what's there (a memory shared on the deployment stays), newest first.
  const existing = (await store.get<GalleryEntry[]>("gallery")) ?? [];
  const ids = new Set(out.map((e) => e.id));
  const merged = [...out, ...existing.filter((e) => !ids.has(e.id))].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  await store.set("gallery", merged);
  console.log(`gallery written: ${merged.length} memories`);
}
