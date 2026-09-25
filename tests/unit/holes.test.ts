import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createProvenanceUniforms, setHoles } from "@/components/world/provenance";
import { growBox } from "@/lib/world/holes";

describe("the world's copies", () => {
  it("grows a box to catch a copy a few cm off, within the photo", () => {
    const [x0, , , y1] = growBox([0.1, 0.2, 0.3, 0.4]);
    expect(x0).toBeCloseTo(0.1 - 0.02 - 0.008);
    expect(y1).toBeCloseTo(0.4 + 0.02 + 0.008);
    expect(growBox([0, 0, 1, 1])).toEqual([0, 0, 1, 1]);
  });

  it("packs wall and object holes four texels a row", () => {
    const u = createProvenanceUniforms();
    setHoles(u, [
      {
        id: "portrait",
        kind: "wall",
        box: [0.1, 0.1, 0.2, 0.2],
        center: new THREE.Vector3(1, 2, -4),
        normal: new THREE.Vector3(0, 0, 1),
        thickness: 0.12,
        color: new THREE.Color(0.9, 0.8, 0.7),
      },
      {
        id: "lamp",
        kind: "object",
        box: [0.4, 0.4, 0.6, 0.8],
        center: new THREE.Vector3(0, -0.5, -2),
        radius: 0.3,
        front: 0.2,
        back: -0.01,
        floor: -0.75,
      },
    ]);
    expect(u.holeCount.value).toBe(2);
    const data = (u.holes.value as THREE.DataTexture).image.data as Float32Array;
    expect([...data.slice(4, 8)]).toEqual([1, 2, -4, expect.closeTo(0.12)]);
    expect(data[15]).toBe(1); // a wall: repainted
    expect([...data.slice(24, 28)].map((v) => Math.round(v * 100) / 100)).toEqual([
      -0.75, 0.2, -0.01, 1,
    ]);
    expect(data[31]).toBe(0); // an object: erased
  });
});
