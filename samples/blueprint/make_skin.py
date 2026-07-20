#!/usr/bin/env python3
"""Generate a custom skin from a bundle's own topology.

Design note: the original texture's LUMINANCE is kept as a multiplier. Painting a flat
synthetic pattern over a character throws away every fold, seam and baked shadow, and the
result reads as a cardboard cut-out in game. Modulating by the original's light keeps the
garment's 3D form while the colour and pattern are entirely new.
"""
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

B = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

g = json.load(open(os.path.join(B, "model.gltf"), encoding="utf8"))
binb = open(os.path.join(B, "model.bin"), "rb").read()
CT = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NC = {"VEC2": 2, "VEC3": 3, "VEC4": 4, "SCALAR": 1}


def acc(i):
    a = g["accessors"][i]
    f, s = CT[a["componentType"]]
    n = NC[a["type"]]
    bv = g["bufferViews"][a["bufferView"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    st = bv.get("byteStride") or s * n
    return [struct.unpack_from("<" + f * n, binb, base + k * st) for k in range(a["count"])]


def uv_tris(hash_):
    """UV triangles for the finest LOD rung that uses this texture."""
    best = None
    for mesh in g["meshes"]:
        nm = mesh.get("name", "")
        if not nm.startswith("LOD"):
            continue
        lod = int(nm[3])
        for p in mesh["primitives"]:
            e = g["materials"][p["material"]].get("extras") or {}
            if e.get("diffuse") == hash_:
                best = lod if best is None else min(best, lod)
    out = []
    for mesh in g["meshes"]:
        nm = mesh.get("name", "")
        if not nm.startswith("LOD%d_" % best):
            continue
        for p in mesh["primitives"]:
            e = g["materials"][p["material"]].get("extras") or {}
            if e.get("diffuse") != hash_:
                continue
            uv, ix = acc(p["attributes"]["TEXCOORD_0"]), acc(p["indices"])
            for i in range(0, len(ix) - 2, 3):
                out.append(tuple(uv[ix[i + k][0]] for k in range(3)))
    return out


# --- palette ------------------------------------------------------------------
NAVY = np.array([9, 17, 34], np.float32)
NAVY2 = np.array([16, 32, 62], np.float32)
GRID = (34, 78, 122)
WIRE = (255, 64, 160)
GLOW = (120, 60, 190)
CYAN = (90, 205, 255)


def build(tex_hash, path):
    src = Image.open(path).convert("RGB")
    W, H = src.size
    a = np.array(src).astype(np.float32)

    # Luminance of the original, gently lifted: this is what keeps folds and seams readable.
    lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255.0
    lum = np.clip(lum, 0, 1)
    lum = 0.45 + 0.85 * (lum ** 0.85)                     # compress toward mid, keep contrast

    # Base field: a soft diagonal gradient so large flat areas are not dead.
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    t = ((xx / W) * 0.6 + (yy / H) * 0.4)[..., None]
    base = NAVY * (1 - t) + NAVY2 * t

    # Blueprint grid, drawn at texel scale so it survives the mip chain.
    grid = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(grid)
    step = max(16, W // 16)
    for x in range(0, W, step):
        gd.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(0, H, step):
        gd.line([(0, y), (W, y)], fill=GRID, width=1)
    for x in range(0, W, step * 4):
        gd.line([(x, 0), (x, H)], fill=CYAN, width=1)
    for y in range(0, H, step * 4):
        gd.line([(0, y), (W, y)], fill=CYAN, width=1)
    grid = np.array(grid).astype(np.float32) * 0.55

    # The character's own topology, drawn onto its own surface.
    tris = uv_tris(tex_hash)
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gl = ImageDraw.Draw(glow)
    core = Image.new("RGB", (W, H), (0, 0, 0))
    cd = ImageDraw.Draw(core)
    for tri in tris:
        pts = [(u * W, v * H) for (u, v) in tri]
        gl.polygon(pts, outline=GLOW)
        cd.polygon(pts, outline=WIRE)
    # A wide blur under a sharp core reads as emission, and it also gives DXT1's 4x4
    # blocks something to interpolate instead of ringing on a hard 1px line.
    glow = np.array(glow.filter(ImageFilter.GaussianBlur(W / 190.0))).astype(np.float32) * 2.1
    core = np.array(core).astype(np.float32)

    out = base + grid + glow
    out = out * lum[..., None]                            # <- the original's light
    out = np.maximum(out, core * 0.92)                    # wireframe stays crisp on top
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    man = json.load(open(os.path.join(B, "manifest.json"), encoding="utf8"))
    todo = json.loads(sys.argv[3])
    for h in todo:
        f = next(t["file"] for t in man["textures"] if t["hash"] == h)
        img = build(h, os.path.join(B, f))
        img.save(os.path.join(OUT, "%s.png" % h))
        w, ht = img.size
        with open(os.path.join(OUT, "%s.raw" % h), "wb") as fh:
            fh.write(struct.pack("<II", w, ht))
            fh.write(np.array(img).tobytes())
        print("  %s  %dx%d" % (h, w, ht))
