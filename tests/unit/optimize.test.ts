import { readFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { describe, expect, it } from "vitest";
import { optimizeGlb } from "@/lib/pipeline/optimize-glb";

describe("mesh optimization", () => {
  it("produces a valid, smaller GLB with the same geometry", async () => {
    const input = new Uint8Array(await readFile("public/demo/object.glb"));
    const output = await optimizeGlb(input);
    expect(output.length).toBeLessThan(input.length);

    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const count = async (bytes: Uint8Array) => {
      const doc = await io.readBinary(bytes);
      return doc
        .getRoot()
        .listMeshes()
        .flatMap((m) => m.listPrimitives())
        .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0), 0);
    };
    expect(await count(output)).toBe(await count(input));
  });
});
