#!/usr/bin/env python3
"""Build REDISTRIBUTABLE repaint templates -- structure only, no game artwork.

The obvious template (the original texture dimmed under a wireframe) cannot be shipped:
it contains the artwork. This builds one from derived data alone -- UV layout, mesh
connectivity and skin weights -- so it carries no pixel of the original.

It is also more useful for identification than the dimmed version. Each UV island is
filled with a flat colour keyed to the BONE that actually drives its vertices, so a blob
reads as "right forearm" instead of "some shape". The palette is fixed across characters,
so it is learned once.

  python make_safe_template.py <bundle_dir> <out_dir> [skeleton.json ...]
"""
import json
import math
import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

CT = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NC = {"VEC2": 2, "VEC3": 3, "VEC4": 4, "SCALAR": 1}

# Fixed region palette. Grouped so left/right read as siblings and the eye can scan a
# sheet without consulting the legend every time.
REGION_COLOURS = [
    ("head", (214, 118, 92)), ("neck", (196, 104, 82)), ("jaw", (224, 140, 110)),
    ("chest", (92, 132, 190)), ("spine", (74, 110, 166)), ("hips", (60, 90, 140)),
    ("lclav", (108, 180, 150)), ("lbicep", (86, 168, 132)), ("lforearm", (66, 148, 114)),
    ("lhand", (140, 200, 172)),
    ("rclav", (196, 160, 90)), ("rbicep", (182, 142, 70)), ("rforearm", (162, 122, 56)),
    ("rhand", (214, 184, 124)),
    ("lthigh", (150, 110, 180)), ("lshin", (128, 90, 160)), ("lfoot", (172, 140, 200)),
    ("rthigh", (186, 96, 140)), ("rshin", (164, 76, 120)), ("rfoot", (206, 132, 168)),
    ("other", (110, 118, 132)),
]
CMAP = dict(REGION_COLOURS)

BONE_TO_REGION = [
    ("lfootbone", "lfoot"), ("rfootbone", "rfoot"), ("ltoe", "lfoot"), ("rtoe", "rfoot"),
    ("lshin", "lshin"), ("rshin", "rshin"), ("lthigh", "lthigh"), ("rthigh", "rthigh"),
    ("lhand", "lhand"), ("rhand", "rhand"),
    ("lfinger", "lhand"), ("rfinger", "rhand"), ("lthumb", "lhand"), ("rthumb", "rhand"),
    ("lforearm", "lforearm"), ("rforearm", "rforearm"),
    ("lbicep", "lbicep"), ("rbicep", "rbicep"),
    ("lclav", "lclav"), ("rclav", "rclav"), ("lshoulder", "lclav"), ("rshoulder", "rclav"),
    ("head", "head"), ("skull", "head"), ("eye", "head"), ("brow", "head"),
    ("nose", "head"), ("cheek", "head"), ("mouth", "head"), ("ear", "head"),
    ("jaw", "jaw"), ("tongue", "jaw"), ("neck", "neck"),
    ("chest", "chest"), ("spine", "spine"), ("hips", "hips"), ("pelvis", "hips"),
]


def region_of(bone_name):
    b = (bone_name or "").lower()
    for key, reg in BONE_TO_REGION:
        if key in b:
            return reg
    return "other"


def load_gltf(bundle):
    g = json.load(open(os.path.join(bundle, "model.gltf"), encoding="utf8"))
    binb = open(os.path.join(bundle, "model.bin"), "rb").read()

    def acc(i):
        a = g["accessors"][i]
        f, s = CT[a["componentType"]]
        n = NC[a["type"]]
        bv = g["bufferViews"][a["bufferView"]]
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        st = bv.get("byteStride") or s * n
        return [struct.unpack_from("<" + f * n, binb, base + k * st) for k in range(a["count"])]

    return g, acc


def bone_names(g, skeletons):
    """joint index -> real bone name, via the hash embedded in the node name."""
    import re
    by_hash = {}
    for sk in skeletons:
        for b in sk["bones"]:
            by_hash.setdefault(b["hash"].upper(), b["name"])
    out = {}
    sk0 = (g.get("skins") or [{}])[0]
    for j, node in enumerate(sk0.get("joints", [])):
        nm = g["nodes"][node].get("name", "")
        m = re.search(r"0x([0-9A-Fa-f]{8})", nm)
        out[j] = by_hash.get(m.group(1).upper(), nm) if m else nm
    return out


class DSU:
    def __init__(s, n): s.p = list(range(n))
    def find(s, a):
        while s.p[a] != a:
            s.p[a] = s.p[s.p[a]]; a = s.p[a]
        return a
    def union(s, a, b):
        ra, rb = s.find(a), s.find(b)
        if ra != rb: s.p[rb] = ra


NAMES = {}


def build(bundle, out_dir, skeletons):
    g, acc = load_gltf(bundle)
    man = json.load(open(os.path.join(bundle, "manifest.json"), encoding="utf8"))
    names = bone_names(g, skeletons)
    tex_by_hash = {t["hash"]: t for t in man["textures"]}

    # finest LOD per diffuse sheet
    lods = {}
    for mesh in g["meshes"]:
        nm = mesh.get("name", "")
        if not nm.startswith("LOD"):
            continue
        for p in mesh["primitives"]:
            h = (g["materials"][p["material"]].get("extras") or {}).get("diffuse")
            if h:
                lods[h] = min(lods.get(h, 9), int(nm[3]))

    per_sheet = {}
    for mesh in g["meshes"]:
        nm = mesh.get("name", "")
        if not nm.startswith("LOD"):
            continue
        lod = int(nm[3])
        for p in mesh["primitives"]:
            h = (g["materials"][p["material"]].get("extras") or {}).get("diffuse")
            a = p["attributes"]
            if not h or lods[h] != lod or "TEXCOORD_0" not in a or "indices" not in p:
                continue
            uv = acc(a["TEXCOORD_0"])
            ix = [t[0] for t in acc(p["indices"])]
            J = acc(a["JOINTS_0"]) if "JOINTS_0" in a else None
            W = acc(a["WEIGHTS_0"]) if "WEIGHTS_0" in a else None
            per_sheet.setdefault(h, []).append((uv, ix, J, W))

    made = []
    for h, parts in per_sheet.items():
        t = tex_by_hash.get(h)
        if not t:
            continue
        Wd, Ht = t["width"], t["height"]
        tri_count = sum(len(ix) // 3 for _, ix, _, _ in parts)
        if tri_count < 250:
            continue

        # Supersample, then downsample at the end. A 512 head sheet can carry 16,000+
        # triangles -- about one per 16 pixels -- and drawing every edge one pixel wide at
        # final size buried up to 54% of the sheet under black lines. Rendering large and
        # shrinking turns that from aliased mush into a soft tint that still reads as
        # "dense here" without hiding what you are painting.
        SS = 3
        SW, SH = Wd * SS, Ht * SS
        # Density decides how hard the interior wireframe is drawn. Below ~1 triangle per
        # 40 target pixels it is genuine information; well above that it is noise, so it
        # fades toward the fill colour rather than being drawn as a hard line.
        density = tri_count / float(Wd * Ht)
        fade = max(0.0, min(1.0, (density - 0.006) / 0.05))

        img = Image.new("RGB", (SW, SH), (18, 22, 30))
        d = ImageDraw.Draw(img)

        for uv, ix, J, W in parts:
            n = len(uv)
            dsu = DSU(n)
            for i in range(0, len(ix) - 2, 3):
                dsu.union(ix[i], ix[i + 1]); dsu.union(ix[i], ix[i + 2])
            # dominant bone per island, weighted
            acc_w = {}
            if J and W:
                for v in range(n):
                    r = dsu.find(v)
                    slot = acc_w.setdefault(r, {})
                    for k in range(4):
                        if W[v][k] > 0:
                            slot[J[v][k]] = slot.get(J[v][k], 0) + W[v][k]
            reg = {}
            for r, sl in acc_w.items():
                best = max(sl.items(), key=lambda kv: kv[1])[0]
                reg[r] = region_of(names.get(best, ""))
            # Vary lightness per island. Without this a head or hair sheet -- where every
            # island is driven by the same bone -- comes out a single flat colour and the
            # layout is unreadable. The shift is deterministic from the island root so it
            # is stable between runs.
            def shade(base, root):
                f = 0.78 + 0.30 * (((root * 2654435761) >> 8) & 0xFF) / 255.0
                return tuple(max(0, min(255, int(ch * f))) for ch in base)

            for i in range(0, len(ix) - 2, 3):
                pts = [(uv[ix[i + k]][0] * SW, uv[ix[i + k]][1] * SH) for k in range(3)]
                root = dsu.find(ix[i])
                d.polygon(pts, fill=shade(CMAP.get(reg.get(root, "other"), CMAP["other"]), root))

        # Interior wireframe over the flats. Its darkness is scaled by `fade`: crisp on a
        # sparse sheet where the mesh is worth seeing, nearly invisible on a dense one
        # where it would just bury the fills.
        wire_dark = tuple(int(20 + (110 - 20) * fade) for _ in range(3))
        for uv, ix, _, _ in parts:
            for i in range(0, len(ix) - 2, 3):
                pts = [(uv[ix[i + k]][0] * SW, uv[ix[i + k]][1] * SH) for k in range(3)]
                d.polygon(pts, outline=wire_dark)
        for uv, ix, _, _ in parts:
            edge = {}
            for i in range(0, len(ix) - 2, 3):
                for a_, b_ in ((0, 1), (1, 2), (2, 0)):
                    e = tuple(sorted((ix[i + a_], ix[i + b_])))
                    edge[e] = edge.get(e, 0) + 1
            for (a_, b_), cnt in edge.items():
                if cnt == 1:      # island boundary: the line that matters when painting
                    d.line([(uv[a_][0] * SW, uv[a_][1] * SH), (uv[b_][0] * SW, uv[b_][1] * SH)],
                           fill=(255, 255, 255), width=max(SS, SW // 340))

        img = img.resize((Wd, Ht), Image.LANCZOS)
        nm_out = NAMES.get(h.upper(), t.get("file", h).split("/")[-1].replace(".png", ""))
        img.save(os.path.join(out_dir, "%s_SAFE.png" % nm_out))

        # Wire-only layer on transparency: pure geometry, useful as a top layer in an
        # image editor. Also safe to redistribute -- there is no artwork in it.
        wire = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
        wd = ImageDraw.Draw(wire)
        for uv, ix, _, _ in parts:
            for i in range(0, len(ix) - 2, 3):
                wd.polygon([(uv[ix[i + k]][0] * SW, uv[ix[i + k]][1] * SH) for k in range(3)],
                           outline=(255, 64, 160, 220))
        wire.resize((Wd, Ht), Image.LANCZOS).save(os.path.join(out_dir, "%s_wire.png" % nm_out))
        made.append((nm_out, h, Wd, Ht, tri_count))
        print("  %-30s %4dx%-4d %6d tris" % (nm_out, Wd, Ht, tri_count))
    return made


def legend(path):
    rowh, sw, W = 22, 26, 300
    used = [r for r in REGION_COLOURS]
    img = Image.new("RGB", (W, 14 + rowh * len(used)), (18, 22, 30))
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
    except Exception:
        f = ImageFont.load_default()
    for i, (nm, col) in enumerate(used):
        y = 7 + i * rowh
        d.rectangle([10, y, 10 + sw, y + rowh - 6], fill=col)
        d.text((10 + sw + 10, y), nm, fill=(226, 232, 240), font=f)
    img.save(path)


if __name__ == "__main__":
    bundle, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    sks = []
    for p in sys.argv[3:]:
        if p.endswith("names.json"):
            NAMES.update({k.upper(): v for k, v in json.load(open(p, encoding="utf8")).items()})
        else:
            sks.append(json.load(open(p, encoding="utf8")))
    made = build(bundle, out_dir, sks)
    legend(os.path.join(out_dir, "_LEGEND.png"))
    json.dump([{"name": m[0], "hash": m[1], "w": m[2], "h": m[3], "tris": m[4]} for m in made],
              open(os.path.join(out_dir, "_sheets.json"), "w"), indent=1)
