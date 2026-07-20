#!/usr/bin/env python3
"""Catalogue a folder of exported character bundles.

A folder of 85 bundles is 500 MB of JSON and PNG that nobody can browse. This walks it
once and writes, next to the bundles:

    index.json   machine-readable: every character, every sheet, real dimensions
    INDEX.md     the same thing as a table you can actually read
    sheets.csv   one row per texture sheet, for sorting in a spreadsheet

★ The dimensions here are the real ones, read from each bundle's own manifest. That matters
because the shipped catalogue (data/donors.json) sources them from `--tex-scan`, which
covers only 3,777 of the game's 13,374 textures and leaves most sheets null. A full
extraction is the only complete source, so `--refresh-donors` can fold them back in.

    python index_bundles.py [cache_dir] [--refresh-donors]
"""
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DONORS = os.path.join(HERE, "..", "data", "donors.json")

FACTIONS = {
    "pmc": "PMC (your crew)", "vz": "Venezuela", "al": "Allied Nations",
    "ch": "Chinese", "gr": "Universal Petroleum", "oc": "Oil corp",
    "pr": "Pirates", "civ": "Civilian", "police": "Police", "cartel": "Cartel",
}
PART_ORDER = {"ub": 0, "lb": 1, "head": 2, "hair": 3, "eyes": 4}
SHEET_RE = re.compile(r"_(ub|lb|head|hair|eyes)[a-z]?$")


def part_of(name):
    m = SHEET_RE.search((name or "").lower())
    return m.group(1) if m else "other"


def dir_size(p):
    n = 0
    for dp, _, fn in os.walk(p):
        for f in fn:
            try:
                n += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return n


def load_names():
    """hash -> name, from the repo's recovered list. Character SHEET names are mostly not
    in it, so also fold in whatever the bundles themselves resolved."""
    path = os.path.join(HERE, "..", "data", "asset_names.txt")
    out = {}
    if not os.path.isfile(path):
        return out

    def h(s):
        v = 0x811C9DC5
        for c in s.encode():
            v = ((v ^ (c | 0x20)) * 0x01000193) & 0xFFFFFFFF
        v ^= 0x2A
        return (v * 0x01000193) & 0xFFFFFFFF

    prev = ""
    for line in open(path, encoding="utf8").read().split("\n"):
        if not line:
            continue
        n = prev[:ord(line[0]) - 48] + line[1:]
        out["0x%08X" % h(n)] = n
        prev = n
    return out


def sheet_names_from_templates():
    """The template bake was handed the workshop's own name table and preserved it in
    _sheets.json. Character sheet names live there and almost nowhere else."""
    out = {}
    root = os.path.join(HERE, "..", "templates")
    if not os.path.isdir(root):
        return out
    for c in os.listdir(root):
        p = os.path.join(root, c, "_sheets.json")
        if os.path.isfile(p):
            for s in json.load(open(p, encoding="utf8")):
                out[s["hash"].upper()] = s["name"]
    return out


def read_bundle(d):
    man = json.load(open(os.path.join(d, "manifest.json"), encoding="utf8"))
    name = man.get("name") or os.path.basename(d)

    # Triangles per diffuse sheet, at the finest rung it is drawn at -- this is what tells
    # a real body sheet apart from a 16x16 scrap.
    finest, tris = {}, {}
    for g in man.get("draw_groups", []):
        h = g.get("diffuse")
        if not h:
            continue
        r = g.get("lod_rung", 0)
        if h not in finest or r < finest[h]:
            finest[h], tris[h] = r, 0
        if r == finest[h]:
            tris[h] += g.get("triangles", 0)

    lod = man.get("lod_chain") or []
    return {
        "name": name,
        "hash": man.get("model_hash"),
        "faction": FACTIONS.get(name.split("_")[0], name.split("_")[0]),
        "skinned": man.get("skinned"),
        "bones": man.get("bones"),
        "clips": len(man.get("clips") or []),
        "drawGroups": len(man.get("draw_groups") or []),
        "lodBlocks": [b.get("block") for b in lod],
        # ★ Chain DEPTH, which is not the same thing as donors.json's `blocks` -- that is
        # 1 or 2 depending only on whether the ASET row's `sub` points anywhere. Measured
        # over a full extraction the real depth is 1, 2 or 3, and three characters have a
        # third rung. The two agree on what actually matters (0 clone-safety disagreements
        # across the roster), but do not compare the numbers directly.
        "blocks": len(lod),
        # This is the decision. Anything deeper than one block loses its finer rungs when
        # cloned, and renders its coarsest tier at every distance.
        "cloneSafe": len(lod) <= 1,
        "textures": man.get("textures") or [],
        "_tris": tris,
        "_dir": d,
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = args[0] if args else r"C:\mercs2-skins"
    refresh = "--refresh-donors" in sys.argv
    if not os.path.isdir(root):
        raise SystemExit("no such folder: %s" % root)

    names = load_names()
    names.update(sheet_names_from_templates())

    chars = []
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if not os.path.isfile(os.path.join(p, "manifest.json")):
            continue
        try:
            chars.append(read_bundle(p))
        except Exception as e:
            print("  skip %s: %s" % (d, e))

    if not chars:
        raise SystemExit("no bundles found in %s" % root)

    for c in chars:
        sheets = []
        for t in c["textures"]:
            h = t["hash"]
            tri = c["_tris"].get(h, 0)
            nm = names.get(h.upper())
            sheets.append({
                "hash": h,
                "name": nm,
                "part": part_of(nm) if nm else "other",
                "width": t.get("width"),
                "height": t.get("height"),
                "triangles": tri,
                "drawn": tri > 0,
                "file": t.get("file"),
            })
        # biggest painted sheets first: that is the order someone reskinning cares about
        sheets.sort(key=lambda s: (PART_ORDER.get(s["part"], 9), -s["triangles"]))
        c["sheets"] = sheets
        c["paintedSheets"] = sum(1 for s in sheets if s["drawn"])
        c["bytes"] = dir_size(c["_dir"])
        del c["_tris"], c["textures"]

    total = sum(c["bytes"] for c in chars)
    safe = sum(1 for c in chars if c["cloneSafe"])

    out = {
        "cache": root,
        "characters": len(chars),
        "cloneSafe": safe,
        "bytes": total,
        "note": "Generated by tools/index_bundles.py. Dimensions are read from each "
                "bundle's own manifest, so they are complete -- unlike --tex-scan.",
        "list": chars,
    }
    json.dump(out, open(os.path.join(root, "index.json"), "w"), indent=1)

    # ---- readable table
    md = ["# Mercenaries 2 character cache", "",
          "%d characters, %d clone-safe, %.1f GB in `%s`."
          % (len(chars), safe, total / 1e9, root), "",
          "Generated by `tools/index_bundles.py`. `clone` = the character keeps full detail",
          "when duplicated as a new asset (one LOD block); `flat` = cloning it loses the",
          "finer rungs and the face visibly flattens. See `docs/LOD-CHAIN.md`.", ""]
    by_f = {}
    for c in chars:
        by_f.setdefault(c["faction"], []).append(c)
    for f in sorted(by_f):
        md += ["## %s" % f, "",
               "| character | clone | sheets painted | body sheets | bones | clips | size |",
               "|---|---|---|---|---|---|---|"]
        for c in sorted(by_f[f], key=lambda x: x["name"]):
            body = ", ".join(
                "%s %dx%d" % (s["part"], s["width"], s["height"])
                for s in c["sheets"] if s["drawn"] and s["part"] in ("ub", "lb", "head", "hair"))
            md.append("| `%s` | %s | %d | %s | %s | %d | %.1f MB |"
                      % (c["name"], "clone" if c["cloneSafe"] else "flat %d" % c["blocks"],
                         c["paintedSheets"], body or "—", c["bones"] or "—",
                         c["clips"], c["bytes"] / 1e6))
        md.append("")
    open(os.path.join(root, "INDEX.md"), "w", encoding="utf8").write("\n".join(md))

    # ---- flat sheet table
    with open(os.path.join(root, "sheets.csv"), "w", newline="", encoding="utf8") as fh:
        w = csv.writer(fh)
        w.writerow(["character", "faction", "clone_safe", "sheet", "hash",
                    "part", "width", "height", "triangles", "drawn"])
        for c in chars:
            for s in c["sheets"]:
                w.writerow([c["name"], c["faction"], c["cloneSafe"],
                            s["name"] or "", s["hash"], s["part"],
                            s["width"], s["height"], s["triangles"], s["drawn"]])

    print("  %d characters (%d clone-safe), %.1f GB" % (len(chars), safe, total / 1e9))
    print("  index.json  INDEX.md  sheets.csv  ->  %s" % root)

    if refresh:
        refresh_donors(chars)


def refresh_donors(chars):
    """Fold the REAL sheet dimensions back into the shipped catalogue.

    donors.json gets its dimensions from `--tex-scan`, which reports 3,777 of 13,374
    textures, so most sheets ship as null and the tool cannot tell anyone how big a sheet
    is before they export it. A full extraction knows all of them.
    """
    if not os.path.isfile(DONORS):
        print("  (no data/donors.json to refresh)")
        return
    cat = json.load(open(DONORS, encoding="utf8"))
    by_name = {c["name"]: c for c in chars}
    filled = 0
    for d in cat.get("donors", []):
        src = by_name.get(d["name"])
        if not src:
            continue
        real = {s["name"]: s for s in src["sheets"] if s["name"] and s["drawn"]}
        for s in d.get("sheets", []):
            r = real.get(s["name"])
            if r and r["width"]:
                new = "%dx%d" % (r["width"], r["height"])
                if s.get("size") != new:
                    s["size"] = new
                    filled += 1
    json.dump(cat, open(DONORS, "w"), separators=(",", ":"))
    print("  refreshed %d sheet dimension(s) in data/donors.json" % filled)


if __name__ == "__main__":
    main()
