// Bakes a gallery memory into public/demo/<name>/ so the demo works with no network or keys:
// the 500k splat, hero meshes, sounds and photo, plus lib/demo/<name>.json. The full-res splat
// stays a remote upgrade. Usage:
//   tsx --env-file=.env.local scripts/bake-demo.ts <gallery_id> <name> <fov> <pitch> <yaw>
import { mkdir, writeFile } from "node:fs/promises";
import { readLocalFile } from "../lib/ai/providers/local-storage";
import { getGalleryEntry } from "../lib/gallery";
import { optimizeGlb } from "../lib/pipeline/optimize-glb";
import { getStore } from "../lib/store";

const [id, name, fov, pitch, yaw] = process.argv.slice(2);
if (!id || !name || !fov)
  throw new Error("usage: bake-demo.ts <gallery_id> <name> <fov> <pitch> <yaw>");
const entry = await getGalleryEntry(getStore(), id);
if (!entry?.extras) throw new Error("gallery entry with extras not found");

const dir = `public/demo/${name}`;
await mkdir(dir, { recursive: true });
const fetchTo = async (url: string, file: string) => {
  const local = await readLocalFile(url);
  let bytes: Uint8Array = local ?? Buffer.from(await (await fetch(url)).arrayBuffer());
  // Meshes are compressed for the browser (idempotent if they already are).
  if (file.endsWith(".glb")) bytes = await optimizeGlb(bytes);
  await writeFile(`${dir}/${file}`, bytes);
  console.log(`${file} ${(bytes.length / 1048576).toFixed(1)} MB`);
  return `/demo/${name}/${file}`;
};

const photo = await fetchTo(entry.photoUrl, "photo.jpg");
const splat = await fetchTo(entry.world.splatUrl, "world-500k.spz");
const objects = [];
for (const o of entry.extras.objects.filter((o) => o.state === "done" && o.glbUrl)) {
  objects.push({ ...o, glbUrl: await fetchTo(o.glbUrl as string, `${o.id}.glb`) });
}
const layers = [];
for (const l of entry.extras.layers ?? []) {
  if (l.state !== "done" || !l.url) continue;
  const body = l.body && { ...l.body, url: await fetchTo(l.body.url, `person-${l.id}.glb`) };
  layers.push({ ...l, url: await fetchTo(l.url, `${l.id}.png`), body });
}
const sounds = [];
for (const s of entry.extras.sounds.filter((s) => s.state === "done" && s.url)) {
  // Already part of the demo (music added with scripts/add-music.ts): kept as is.
  const url = s.url as string;
  sounds.push({
    ...s,
    url: url.startsWith(`/demo/${name}/`) ? url : await fetchTo(url, `${s.kind}-${s.id}.mp3`),
  });
}

const baked = {
  galleryId: id,
  photoUrl: photo,
  splatUrl: splat,
  splatUpgradeUrl: entry.world.splatUrlHighRes ?? null,
  splatScale: entry.world.metricScale,
  originalCamera: {
    position: [0, 0, 0],
    rotation: [Number(pitch), Number(yaw), 0],
    fov: Number(fov),
  },
  extras: { ...entry.extras, objects, sounds, layers, done: true },
};
await writeFile(`lib/demo/${name}.json`, `${JSON.stringify(baked, null, 2)}\n`);
console.log(`wrote lib/demo/${name}.json`);
