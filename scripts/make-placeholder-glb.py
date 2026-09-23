"""Writes public/demo/object.glb: a small lathed kettle, the demo's stand-in hero object until a
real Hunyuan3D mesh replaces it. Unit-sized, base at y=0, facing +Z."""
import json, math, struct

profile = [(0.0, 0.0), (0.34, 0.0), (0.42, 0.08), (0.46, 0.22), (0.44, 0.36), (0.36, 0.46),
           (0.2, 0.52), (0.16, 0.56), (0.18, 0.6), (0.08, 0.66), (0.0, 0.68)]
SEG = 48
pos, nrm, idx = [], [], []

def lathe(profile, color_base):
    base = len(pos)
    for i, (r, y) in enumerate(profile):
        for s in range(SEG + 1):
            a = s / SEG * 2 * math.pi
            pos.append((r * math.cos(a), y, r * math.sin(a)))
            # normal from profile tangent
            j0, j1 = max(0, i - 1), min(len(profile) - 1, i + 1)
            dr, dy = profile[j1][0] - profile[j0][0], profile[j1][1] - profile[j0][1]
            nx, ny = dy, -dr
            l = math.hypot(nx, ny) or 1
            nrm.append((nx / l * math.cos(a), ny / l, nx / l * math.sin(a)))
    for i in range(len(profile) - 1):
        for s in range(SEG):
            a = base + i * (SEG + 1) + s
            b = a + SEG + 1
            idx.extend([a, a + 1, b, b, a + 1, b + 1])

lathe(profile, None)

# spout: a tapered tube pointing +Z and up
def tube(start, end, r0, r1, seg=16):
    base = len(pos)
    sx, sy, sz = start; ex, ey, ez = end
    for k, (cx, cy, cz, r) in enumerate([(sx, sy, sz, r0), (ex, ey, ez, r1)]):
        for s in range(seg + 1):
            a = s / seg * 2 * math.pi
            pos.append((cx + r * math.cos(a), cy + r * math.sin(a) * 0.7, cz))
            nrm.append((math.cos(a), math.sin(a), 0.0))
    for s in range(seg):
        a = base + s; b = a + seg + 1
        idx.extend([a, b, a + 1, a + 1, b, b + 1])

tube((0.0, 0.2, 0.36), (0.0, 0.42, 0.66), 0.07, 0.035)

vb = b"".join(struct.pack("<3f", *p) for p in pos)
nb = b"".join(struct.pack("<3f", *n) for n in nrm)
ib = b"".join(struct.pack("<I", i) for i in idx)
def pad(b): return b + b"\x00" * ((4 - len(b) % 4) % 4)
blob = pad(vb) + pad(nb) + pad(ib)
xs = [p[0] for p in pos]; ys = [p[1] for p in pos]; zs = [p[2] for p in pos]
gltf = {
    "asset": {"version": "2.0", "generator": "again placeholder"},
    "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "kettle"}],
    "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
    "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.36, 0.62, 0.72, 1], "metallicFactor": 0.1, "roughnessFactor": 0.45}}],
    "buffers": [{"byteLength": len(blob)}],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(vb), "target": 34962},
        {"buffer": 0, "byteOffset": len(pad(vb)), "byteLength": len(nb), "target": 34962},
        {"buffer": 0, "byteOffset": len(pad(vb)) + len(pad(nb)), "byteLength": len(ib), "target": 34963},
    ],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
        {"bufferView": 1, "componentType": 5126, "count": len(nrm), "type": "VEC3"},
        {"bufferView": 2, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
    ],
}
js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob), 0x004E4942) + blob
open("public/demo/object.glb", "wb").write(out)
print("wrote public/demo/object.glb", len(out), "bytes,", len(idx) // 3, "triangles")
