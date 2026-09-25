/**
 * A person as one 3D model, from two:
 *
 *   Hunyuan3D  the look: hair, face, clothes. Only what the photo shows, so it stops where
 *              the person is hidden (a table in front of their legs).
 *   SAM 3D Body  the skeleton: a complete body in the right pose, in the camera's frame.
 *
 * Hunyuan's mesh is fitted onto SAM's body with a scale-aware ICP (trimmed, so clothing and
 * hair a bare body lacks don't dominate), from several starting guesses. SAM's legs and feet
 * then fill in below Hunyuan's hem. The result lives in SAM's camera frame, like the body.
 */
import { type Document, NodeIO, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import sharp from "sharp";
import { optimizeGlb } from "./optimize-glb";

type Vec = [number, number, number];
type Mat = number[]; // 3x3, row-major

export interface Fit {
  scale: number;
  rotation: Mat;
  translation: Vec;
  /** 65th-percentile distance between the fitted surfaces, metres. */
  error: number;
}

/** Above this, the two models don't agree about the person: keep the flat photo layer. */
export const MAX_FIT_ERROR = 0.05;

let io: Promise<NodeIO> | null = null;
function getIO() {
  io ??= MeshoptDecoder.ready.then(() =>
    new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder }),
  );
  return io;
}

/** World-space vertex positions of every primitive under the given nodes (or all). */
function points(doc: Document, only?: (name: string) => boolean): Float32Array {
  const out: number[] = [];
  const v: number[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || (only && !only(node.getName()))) continue;
    const m = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute("POSITION");
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const [x, y, z] = v;
        out.push(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        );
      }
    }
  }
  return new Float32Array(out);
}

/** Nearest-neighbour lookups on a fixed point set, via a uniform grid. */
class Grid {
  private cells = new Map<number, number[]>();
  constructor(
    private readonly pts: Float32Array,
    private readonly cell = 0.05,
  ) {
    for (let i = 0; i < pts.length / 3; i++) {
      const k = this.key(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private key(x: number, y: number, z: number) {
    return Grid.pack(
      Math.floor(x / this.cell),
      Math.floor(y / this.cell),
      Math.floor(z / this.cell),
    );
  }
  private static pack(i: number, j: number, k: number) {
    return (i + 1024) * 4194304 + (j + 1024) * 2048 + (k + 1024);
  }
  /** Index and distance of the nearest point, searching outward ring by ring. */
  nearest(x: number, y: number, z: number): [number, number] {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 40; r++) {
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++)
          for (let k = -r; k <= r; k++) {
            if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue;
            for (const idx of this.cells.get(Grid.pack(cx + i, cy + j, cz + k)) ?? []) {
              const dx = this.pts[idx * 3] - x;
              const dy = this.pts[idx * 3 + 1] - y;
              const dz = this.pts[idx * 3 + 2] - z;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < bestD) {
                bestD = d;
                best = idx;
              }
            }
          }
      // Anything in a farther ring is at least r cells away.
      if (best >= 0 && Math.sqrt(bestD) <= r * this.cell) break;
    }
    return [best, Math.sqrt(bestD)];
  }
}

const apply = (s: number, R: Mat, t: Vec, x: number, y: number, z: number): Vec => [
  s * (R[0] * x + R[1] * y + R[2] * z) + t[0],
  s * (R[3] * x + R[4] * y + R[5] * z) + t[1],
  s * (R[6] * x + R[7] * y + R[8] * z) + t[2],
];

const det3 = (m: Mat) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[1] * (m[3] * m[8] - m[5] * m[6]) +
  m[2] * (m[3] * m[7] - m[4] * m[6]);

/** Best similarity transform taking points a onto b (Umeyama 1991). */
function umeyama(a: Vec[], b: Vec[]): { s: number; R: Mat; t: Vec } {
  const n = a.length;
  const ma: Vec = [0, 0, 0];
  const mb: Vec = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      ma[k] += a[i][k] / n;
      mb[k] += b[i][k] / n;
    }
  const cov = Matrix.zeros(3, 3);
  let varA = 0;
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 3; r++) {
      varA += (a[i][r] - ma[r]) ** 2 / n;
      for (let c = 0; c < 3; c++) {
        cov.set(r, c, cov.get(r, c) + ((b[i][r] - mb[r]) * (a[i][c] - ma[c])) / n);
      }
    }
  }
  const svd = new SingularValueDecomposition(cov);
  const U = svd.leftSingularVectors;
  const V = svd.rightSingularVectors;
  const S = svd.diagonal;
  const d = det3(U.mmul(V.transpose()).to1DArray()) < 0 ? -1 : 1;
  const D = Matrix.diag([1, 1, d]);
  const Rm = U.mmul(D).mmul(V.transpose());
  const s = (S[0] + S[1] + d * S[2]) / varA;
  const R = Rm.to1DArray();
  const Rma = [0, 1, 2].map((r) => R[r * 3] * ma[0] + R[r * 3 + 1] * ma[1] + R[r * 3 + 2] * ma[2]);
  return { s, R, t: [mb[0] - s * Rma[0], mb[1] - s * Rma[1], mb[2] - s * Rma[2]] };
}

const yaw = (deg: number): Mat => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), 0, Math.sin(r), 0, 1, 0, -Math.sin(r), 0, Math.cos(r)];
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor((sorted.length - 1) * p)];
};

/** Fits `shape` points onto `body` points: many rough starts on a sample, the best few refined. */
export function fitShapeToBody(shape: Float32Array, body: Float32Array): Fit {
  const sample = (n: number) => {
    const out: Vec[] = [];
    const stride = Math.max(1, Math.floor(shape.length / 3 / n));
    for (let i = 0; i < shape.length / 3; i += stride)
      out.push([shape[i * 3], shape[i * 3 + 1], shape[i * 3 + 2]]);
    return out;
  };
  const src = sample(3000);
  const rough = sample(600);
  const grid = new Grid(body);
  const bodyPts: Vec[] = [];
  for (let i = 0; i < body.length / 3; i += 3)
    bodyPts.push([body[i * 3], body[i * 3 + 1], body[i * 3 + 2]]);
  const height = (pts: Vec[]) => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
    return hi - lo;
  };
  const top = (pts: Vec[]) => {
    const cut = percentile(
      pts.map((p) => p[1]),
      0.95,
    );
    const head = pts.filter((p) => p[1] >= cut);
    return [0, 1, 2].map((k) => head.reduce((s, p) => s + p[k], 0) / head.length) as Vec;
  };
  const bodyH = height(bodyPts);
  const srcH = height(src);
  const headBody = top(bodyPts);
  const headSrc = top(src);

  /** Trimmed ICP from a start. The error is measured, then improved; stops once it settles. */
  const icp = (pts: Vec[], start: Omit<Fit, "error">, iterations: number): Fit => {
    let { scale: s, rotation: R, translation: t } = start;
    let error = Number.POSITIVE_INFINITY;
    for (let iter = 0; iter <= iterations; iter++) {
      const pairs = pts.map((p) => {
        const [idx, d] = grid.nearest(...apply(s, R, t, ...p));
        return { p, q: [body[idx * 3], body[idx * 3 + 1], body[idx * 3 + 2]] as Vec, d };
      });
      const cut = percentile(
        pairs.map((x) => x.d),
        0.65,
      );
      const settled = error - cut < 1e-5;
      error = cut;
      if (iter === iterations || settled) break;
      const kept = pairs.filter((x) => x.d <= cut);
      ({ s, R, t } = umeyama(
        kept.map((x) => x.p),
        kept.map((x) => x.q),
      ));
    }
    return { scale: s, rotation: R, translation: t, error };
  };

  // Starts: how much of the body the shape covers (it may stop at a table), and which way it
  // faces; heads aligned.
  const starts: Fit[] = [];
  for (const cover of [0.55, 0.65, 0.75, 0.85, 1]) {
    for (let deg = -60; deg <= 60; deg += 15) {
      const scale = (bodyH * cover) / srcH;
      const rotation = yaw(deg);
      const h = apply(scale, rotation, [0, 0, 0], ...headSrc);
      const translation: Vec = [headBody[0] - h[0], headBody[1] - h[1], headBody[2] - h[2]];
      starts.push(icp(rough, { scale, rotation, translation }, 20));
    }
  }
  starts.sort((x, y) => x.error - y.error);
  return starts
    .slice(0, 3)
    .map((f) => icp(src, f, 30))
    .reduce((x, y) => (y.error < x.error ? y : x));
}

/**
 * Builds the hybrid GLB: `shape` (Hunyuan) transformed onto `bodyNode` of `body` (SAM 3D
 * Body), plus the body's legs and feet below the shape's hem, in the person's own skin tone.
 */
export async function buildHybrid(
  shapeBytes: Uint8Array,
  bodyBytes: Uint8Array,
  bodyNode: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; fit: Fit; skin: [number, number, number] }> {
  const nodeIO = await getIO();
  const shape = await nodeIO.readBinary(shapeBytes);
  const body = await nodeIO.readBinary(bodyBytes);
  const bodyPts = points(body, (name) => name === bodyNode);
  if (bodyPts.length === 0) throw new Error(`no body mesh ${bodyNode}`);
  const fit = fitShapeToBody(points(shape), bodyPts);

  // 1. Hang the whole shape scene under one node carrying the fit.
  const scene = shape.getRoot().getDefaultScene() ?? shape.getRoot().listScenes()[0];
  const holder = shape.createNode("fitted_to_body");
  const R = fit.rotation;
  holder.setMatrix([
    fit.scale * R[0],
    fit.scale * R[3],
    fit.scale * R[6],
    0,
    fit.scale * R[1],
    fit.scale * R[4],
    fit.scale * R[7],
    0,
    fit.scale * R[2],
    fit.scale * R[5],
    fit.scale * R[8],
    0,
    fit.translation[0],
    fit.translation[1],
    fit.translation[2],
    1,
  ]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    holder.addChild(child);
  }
  scene.addChild(holder);
  const skin = await skinTone(shape, bodyPts);

  // 2. The body's legs and feet, below the fitted shape's lowest point (with a little overlap).
  const fitted = points(shape);
  let minY = Number.POSITIVE_INFINITY;
  for (let i = 1; i < fitted.length; i += 3) minY = Math.min(minY, fitted[i]);
  const cut = minY + 0.06;
  const legPrim = legsBelow(body, bodyNode, cut);
  if (legPrim) {
    const buffer = shape.getRoot().listBuffers()[0] ?? shape.createBuffer();
    const material = shape
      .createMaterial("legs")
      .setBaseColorFactor([...skin, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1);
    const prim = shape
      .createPrimitive()
      .setAttribute(
        "POSITION",
        shape.createAccessor().setType("VEC3").setArray(legPrim.positions).setBuffer(buffer),
      )
      .setIndices(
        shape.createAccessor().setType("SCALAR").setArray(legPrim.indices).setBuffer(buffer),
      )
      .setMaterial(material);
    scene.addChild(
      shape.createNode("legs_from_body").setMesh(shape.createMesh("legs").addPrimitive(prim)),
    );
  }
  return { bytes: await optimizeGlb(await nodeIO.writeBinary(shape)), fit, skin };
}

/** Linear, 0..1: a mid grey, for when the skin can't be read. */
const FALLBACK_SKIN: [number, number, number] = [0.3, 0.3, 0.3];
/** Closer than this to the bare body, the shape's surface is skin (clothes and hair stand off). */
const ON_SKIN_M = 0.012;

/**
 * The person's skin tone, read from the fitted shape's own texture where its surface lies on
 * the bare body (face, arms, hands): the median, as a linear glTF colour factor.
 */
async function skinTone(shape: Document, body: Float32Array): Promise<[number, number, number]> {
  const grid = new Grid(body);
  const images = new Map<object, { data: Buffer; width: number; height: number } | null>();
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const v: number[] = [];
  const uv: number[] = [];
  for (const node of shape.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const tex = prim.getAttribute("TEXCOORD_0");
      const texture = prim.getMaterial()?.getBaseColorTexture();
      if (!pos || !tex || !texture) continue;
      if (!images.has(texture)) {
        const bytes = texture.getImage();
        images.set(
          texture,
          bytes
            ? await sharp(Buffer.from(bytes))
                .removeAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true })
                .then(({ data, info }) => ({ data, width: info.width, height: info.height }))
                .catch(() => null)
            : null,
        );
      }
      const image = images.get(texture);
      if (!image) continue;
      const stride = Math.max(1, Math.floor(pos.getCount() / 20000));
      for (let i = 0; i < pos.getCount(); i += stride) {
        pos.getElement(i, v);
        const [x, y, z] = [
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        ];
        if (grid.nearest(x, y, z)[1] > ON_SKIN_M) continue;
        tex.getElement(i, uv);
        const px = Math.min(image.width - 1, Math.max(0, Math.floor(uv[0] * image.width)));
        const py = Math.min(image.height - 1, Math.max(0, Math.floor(uv[1] * image.height)));
        const o = (py * image.width + px) * 3;
        r.push(image.data[o]);
        g.push(image.data[o + 1]);
        b.push(image.data[o + 2]);
      }
    }
  }
  if (r.length < 50) return FALLBACK_SKIN;
  // sRGB texels to a linear factor.
  // A little above the median: shadowed skin (under the chin, between fingers) pulls it down.
  const channel = (c: number[]) => (percentile(c, 0.65) / 255) ** 2.2;
  return [channel(r), channel(g), channel(b)];
}

function legsBelow(doc: Document, nodeName: string, cutY: number) {
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === nodeName);
  const prim: Primitive | undefined = node?.getMesh()?.listPrimitives()[0];
  const pos = prim?.getAttribute("POSITION");
  const idx = prim?.getIndices();
  if (!node || !pos || !idx) return null;
  const m = node.getWorldMatrix();
  const v: number[] = [];
  const world: Vec[] = [];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    world.push([
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
    ]);
  }
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const tri: number[] = [];
  for (let f = 0; f < idx.getCount(); f += 3) {
    tri.length = 0;
    for (let k = 0; k < 3; k++) tri.push(idx.getScalar(f + k));
    if (!tri.every((i) => world[i][1] < cutY)) continue;
    for (const i of tri) {
      let j = remap.get(i);
      if (j === undefined) {
        j = remap.size;
        remap.set(i, j);
        positions.push(...world[i]);
      }
      indices.push(j);
    }
  }
  if (indices.length === 0) return null;
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
