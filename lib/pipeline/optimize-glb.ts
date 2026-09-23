/**
 * Shrinks a generated 3D object for the browser. Image-to-3D models ship uncompressed PNG
 * textures (Hunyuan3D's lamp: 28 of its 33 MB), which don't need to be larger than 1024px
 * for an object a few pixels to a few hundred pixels tall on screen.
 *
 * WebP textures at 1024px + meshopt geometry compression. drei's useGLTF decodes meshopt.
 * Measured: Hunyuan3D lamp 32.6 → 1.2 MB, TRELLIS lamp 1.5 → 0.15 MB, visually identical.
 * (No weld(): TRELLIS meshes have no normals, so merging vertices can only hurt.)
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

export const MAX_TEXTURE = 1024;

let io: Promise<NodeIO> | null = null;

function getIO() {
  io ??= (async () => {
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "meshopt.encoder": MeshoptEncoder,
      "meshopt.decoder": MeshoptDecoder,
    });
  })();
  return io;
}

export async function optimizeGlb(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const nodeIO = await getIO();
  const doc = await nodeIO.readBinary(input);
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [MAX_TEXTURE, MAX_TEXTURE] }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  return new Uint8Array(await nodeIO.writeBinary(doc));
}

/** Downloads a GLB, optimizes it, and returns the new bytes (or null if it didn't help). */
export async function optimizeRemoteGlb(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`couldn't fetch the mesh (${res.status})`);
  const original = new Uint8Array(await res.arrayBuffer());
  const optimized = await optimizeGlb(original);
  return optimized.length < original.length ? optimized : null;
}
