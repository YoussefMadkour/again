// Runs object crops through several fal image-to-3D models and saves the GLBs to
// .data/files/ (served at /api/files/) for a side-by-side look. Spends fal credits.
// Usage: tsx --env-file=.env.local scripts/compare-meshes.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  FalClient,
  FalMeshProvider,
  FalStorage,
  type MeshModel,
} from "../lib/ai/providers/real/fal";
import { DEMO_ANALYSIS } from "../lib/demo/analysis";
import { cropToBox } from "../lib/pipeline/crop";

const key = process.env.FAL_KEY;
if (!key) throw new Error("FAL_KEY missing");
const fal = new FalClient(key);
const storage = new FalStorage(key);

const kettle = DEMO_ANALYSIS.objects.find((o) => o.id === "blue-kettle");
if (!kettle?.bbox) throw new Error("no kettle");
const crops = {
  lamp: new Uint8Array(await readFile(".data/files/crop-table-lamp-6bd70e96a474.jpg")),
  kettle: await cropToBox("public/demo/photo.jpg", kettle.bbox).catch(async () => {
    // cropToBox fetches URLs; read the demo photo from disk instead.
    const sharp = (await import("sharp")).default;
    const img = sharp(await readFile("public/demo/photo.jpg"));
    const { width = 0, height = 0 } = await img.metadata();
    const [x0, y0, x1, y1] = kettle.bbox as readonly number[];
    const pad = 0.12;
    const l = Math.max(0, Math.floor((x0 - (x1 - x0) * pad) * width));
    const t = Math.max(0, Math.floor((y0 - (y1 - y0) * pad) * height));
    const w = Math.min(width - l, Math.ceil((x1 - x0) * (1 + 2 * pad) * width));
    const h = Math.min(height - t, Math.ceil((y1 - y0) * (1 + 2 * pad) * height));
    return new Uint8Array(
      await img
        .extract({ left: l, top: t, width: w, height: h })
        .resize(1024, 1024, { fit: "inside" })
        .jpeg({ quality: 92 })
        .toBuffer(),
    );
  }),
};
await mkdir(".data/files", { recursive: true });
await writeFile(".data/files/crop-demo-kettle.jpg", crops.kettle);

const urls = {
  lamp: await storage.upload(crops.lamp, "image/jpeg", "compare-lamp.jpg"),
  kettle: await storage.upload(crops.kettle, "image/jpeg", "compare-kettle.jpg"),
};
console.log("crops uploaded");

const runs = (process.argv[2] ?? "lamp:trellis,kettle:trellis,lamp:trellis-2,lamp:hunyuan3d-v3")
  .split(",")
  .map((r) => r.split(":") as [keyof typeof urls, MeshModel]);
const suffix = process.argv[3] ?? "";
await Promise.all(
  runs.map(async ([object, model]) => {
    const provider = new FalMeshProvider(fal, model);
    const started = Date.now();
    const handle = await provider.submit(urls[object]);
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await provider.poll(handle);
      if (s.state === "pending") continue;
      const secs = Math.round((Date.now() - started) / 1000);
      if (s.state === "failed")
        return console.log(`${object}/${model}: FAILED after ${secs}s: ${s.error}`);
      const bytes = new Uint8Array(await (await fetch(s.glbUrl)).arrayBuffer());
      const name = `mesh-${object}-${model}${suffix}.glb`;
      await writeFile(`.data/files/${name}`, bytes);
      return console.log(
        `${object}/${model}: ${secs}s, ${(bytes.length / 1048576).toFixed(1)} MB → /api/files/${name}`,
      );
    }
  }),
);
