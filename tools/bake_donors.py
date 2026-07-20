#!/usr/bin/env python3
"""Bake the donor catalogue the web tool offers in its character dropdown.

Getting started is the hardest part of this whole pipeline: a newcomer has to know that
characters exist under names like `vz_hum_solano`, that some of them clone cleanly and
some come out with a flattened face, and which texture sheets they own. All of that is
knowable up front, so it should be baked in rather than rediscovered per person.

Per character:
  name, faction, model hash
  blocks   1 = clone-safe (single LOD block), 2 = cloning loses the finer rungs
  sheets   the diffuse sheets it owns, with real dimensions

★ The clone-safe flag is the important one. An ASET row packs `block << 16 | sub`; for a
character model `sub` is the index of a SECOND block holding the finer LOD rungs, or 65535
for none. Characters with no second block clone perfectly; characters with one render their
coarsest tier at every distance when cloned. See docs/LOD-CHAIN.md.

Inputs (all produced by tools already in this repo or the community project):
  vz_aset.tsv   aset_dump <vz.wad> out.tsv
  texscan.tsv   mercs2_workshop --tex-scan
  asset_names   data/asset_names.txt (this repo)

  python bake_donors.py <vz_aset.tsv> <texscan.tsv> <models.tsv> [out.json]

where models.tsv is `mercs2_workshop --list | grep ^MODELS`.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = os.path.join(HERE, "..", "data", "asset_names.txt")
OUT_DEFAULT = os.path.join(HERE, "..", "data", "donors.json")

FACTIONS = {
    "pmc": "PMC (your crew)", "vz": "Venezuela", "al": "Allied Nations",
    "ch": "Chinese", "gr": "Universal Petroleum", "oc": "Oil corp",
    "pr": "Pirates", "civ": "Civilian", "police": "Police", "cartel": "Cartel",
}
PART_ORDER = {"ub": 0, "lb": 1, "head": 2, "hair": 3}


def h(s):
    """pandemic_hash_m2 -- FNV-1a 32-bit, case-folded, finalised ^0x2A then one more mul."""
    if not s:
        return 0
    v = 0x811C9DC5
    for c in s.encode():
        v = ((v ^ (c | 0x20)) * 0x01000193) & 0xFFFFFFFF
    v ^= 0x2A
    return (v * 0x01000193) & 0xFFFFFFFF


def load_names():
    """Front-coded name list -> {hash: name} using pandemic_hash_m2."""
    names, prev = [], ""
    for line in open(NAMES, encoding="utf8").read().split("\n"):
        if not line:
            continue
        n = prev[:ord(line[0]) - 48] + line[1:]
        names.append(n)
        prev = n
    return {h(n): n for n in names}, names


def main():
    aset_path, texscan_path = sys.argv[1], sys.argv[2]
    models_path = sys.argv[3] if len(sys.argv) > 3 else None
    out_path = sys.argv[4] if len(sys.argv) > 4 else OUT_DEFAULT
    by_hash, all_names = load_names()

    # texture dimensions, keyed by name
    tex = {}
    for line in open(texscan_path, encoding="utf8", errors="ignore"):
        p = line.rstrip("\n").split("\t")
        if len(p) >= 4:
            tex[p[3].strip()] = {"size": p[1].strip(), "fmt": p[2].strip()}

    # model rows: hash -> (block, sub)
    models = {}
    for line in open(aset_path, encoding="utf8", errors="ignore").read().splitlines()[1:]:
        p = line.split("\t")
        if len(p) >= 6 and p[5].strip() == "19":
            models[int(p[0], 16)] = (int(p[2]), int(p[3]))

    # ★ Names come from `mercs2_workshop --list`, NOT from reverse-resolving each hash
    # through the recovered name list. That reverse lookup found 9 of the 85 character
    # models -- every hash absent from the 10,047 recovered names was silently dropped,
    # which threw away 3/4 of the usable donors including civ_hum_beachfemale_c and _d.
    # The workshop prints hash AND name together; use that.
    listed = {}
    if models_path:
        for line in open(models_path, encoding="utf8", errors="ignore"):
            p = line.rstrip("\n").split("\t")
            if len(p) >= 3 and p[0].strip() == "MODELS" and "_hum_" in p[2]:
                listed[int(p[1].strip(), 16)] = p[2].strip()

    donors = []
    for hh, name in sorted(listed.items(), key=lambda kv: kv[1]):
        blk, sub = models.get(hh, (None, 65535))
        sheets = []
        for part in ("ub", "lb", "head", "hair"):
            for cand in ("%s_%s" % (name, part), "%s%s" % (name, part)):
                if cand in tex:
                    sheets.append({"part": part, "name": cand, **tex[cand]})
                    break
        # A character with no body sheets of its own can still be a BASE -- it just borrows
        # someone else's textures, so reskinning it in place is not meaningful. Keep it as a
        # clone donor and say so, rather than hiding it.
        sheets.sort(key=lambda s: PART_ORDER.get(s["part"], 9))
        donors.append({
            "ownSheets": bool([s for s in sheets if s["part"] in ("ub", "lb")]),
            "name": name,
            "faction": FACTIONS.get(name.split("_")[0], name.split("_")[0]),
            "hash": "0x%08X" % hh,
            # 1 = single block, safe to clone. 2 = cloning loses the finer LOD rungs.
            "blocks": 1 if sub == 65535 else 2,
            "lodBlock": None if sub == 65535 else sub,
            "sheets": sheets,
        })

    # ★ TEXTURE-ONLY sets. These names are recovered from TEXTURE names, and every one of
    # them has NO model ASET row and does not appear in `--list MODELS` -- verified, 0 of 67.
    # `mercs2_workshop --export-bundle` therefore fails on all of them with
    #     [FAIL] ch_hum_officer (0xD2A9DF48): no model ASET for 0xD2A9DF48
    # so they CANNOT be loaded into the tool at all: not as a body, not as a reskin target,
    # and not as an outfit donor. They are kept here only to record that the texture sets
    # exist. Never put them in a picker -- an earlier build offered all 67 as outfit donors
    # and every one of them was a dead end.
    # NB: keyed on the NAME LIST, not the texture scan. `--tex-scan` only reported 3,777 of
    # the game's 13,374 textures, so requiring a scan hit silently dropped almost every
    # character. Dimensions are attached when the scan knows them and left null otherwise.
    # Index the name list by (character, part). Sheets carry an optional trailing letter --
    # `civ_hum_aidworker_uba`, `..._ubb` -- and requiring a bare `_ub` found only 4 of the
    # 106 characters that actually own body sheets.
    SHEET_RE = re.compile(r"^(.*?_hum_.*?)_(ub|lb|head|hair)([a-z]?)$")
    owned = {}
    for n in all_names:
        m = SHEET_RE.match(n)
        if m:
            owned.setdefault(m.group(1), {}).setdefault(m.group(2), n)

    have_model = {d["name"] for d in donors}
    reskin = []
    for base, parts in owned.items():
        if base in have_model or h(base) in models:
            continue
        sheets = [{"part": p, "name": parts[p],
                   **(tex.get(parts[p]) or {"size": None, "fmt": None})}
                  for p in ("ub", "lb", "head", "hair") if p in parts]
        if len([s for s in sheets if s["part"] in ("ub", "lb")]) < 2:
            continue
        n = base
        sheets.sort(key=lambda s: PART_ORDER.get(s["part"], 9))
        reskin.append({
            "name": n,
            "faction": FACTIONS.get(n.split("_")[0], n.split("_")[0]),
            "sheets": sheets,
        })
    reskin.sort(key=lambda d: (d["faction"], d["name"]))

    donors.sort(key=lambda d: (d["faction"], d["name"]))
    safe = sum(1 for d in donors if d["blocks"] == 1)
    # ★ Where a template exists, IT is the authority on which sheets a character has: it
    # was generated from what the model actually paints. The name/texscan guess is only a
    # fallback, and `--tex-scan` covers 3,777 of 13,374 textures, so trusting it produced
    # "no own sheets" for characters that plainly have three. Never assert absence from a
    # partial index.
    tpl_root = os.path.join(HERE, "..", "templates")
    for grp in (donors, reskin):
        for c in grp:
            d = os.path.join(tpl_root, c["name"])
            if not os.path.isdir(d):
                continue
            painted = sorted(f[:-len("_SAFE.png")] for f in os.listdir(d)
                             if f.endswith("_SAFE.png"))
            if not painted:
                continue
            known = {s["name"]: s for s in c["sheets"]}
            merged = []
            for nm in painted:
                part = next((p_ for p_ in ("ub", "lb", "head", "hair")
                             if nm.endswith("_" + p_) or nm.endswith(p_)), "other")
                merged.append(known.get(nm) or {"part": part, "name": nm,
                                                "size": None, "fmt": None})
            merged.sort(key=lambda s: PART_ORDER.get(s["part"], 9))
            c["sheets"] = merged
            c["ownSheets"] = any(s["part"] in ("ub", "lb") for s in merged)

    # Assert the split rather than trusting it. The whole reason texture-only entries are
    # dangerous is that they LOOK like characters; if one ever gained a model row it should
    # move into `donors`, and if a donor ever lost one the tool would offer a dead end.
    bad = [d["name"] for d in donors if h(d["name"]) not in models]
    if bad:
        raise SystemExit("donors without a model ASET row (cannot be exported): %s" % bad)
    bad = [r["name"] for r in reskin if h(r["name"]) in models]
    if bad:
        raise SystemExit("texture-only entries that DO have a model row: %s" % bad)

    json.dump({"donors": donors, "textureOnly": reskin},
              open(out_path, "w"), separators=(",", ":"))
    print("%d character MODELS (%d single-block = clone-safe, %d two-block) "
          "+ %d texture-only (NOT exportable) -> %s (%.0f KB)"
          % (len(donors), safe, len(donors) - safe, len(reskin),
             os.path.basename(out_path), os.path.getsize(out_path) / 1024))
    print()
    print("  by faction (single-block / total):")
    for f in sorted({d["faction"] for d in donors}):
        g = [d for d in donors if d["faction"] == f]
        print("    %-22s %2d / %2d" % (f, sum(1 for d in g if d["blocks"] == 1), len(g)))
    print()
    print("  texture-only (NOT exportable), by faction:")
    for f in sorted({d["faction"] for d in reskin}):
        print("    %-22s %2d" % (f, sum(1 for d in reskin if d["faction"] == f)))


if __name__ == "__main__":
    main()
