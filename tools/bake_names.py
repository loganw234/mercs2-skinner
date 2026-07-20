#!/usr/bin/env python3
"""Bake the recovered asset-name list into the tool.

The WAD stores only hashes, so an export bundle gives you `tex_0x8DE46BB7.png` and no clue
what it is. Hashing the recovered name list back gives `civ_hum_beachfemale_a_head` -- which
is both far more usable in the UI and REQUIRED by the modkit, whose texture-swap contract
targets a texture by NAME.

Names are stored front-coded: they share long prefixes (`..._head`, `..._head_nm`,
`..._head_sm`), so each line is "<chars shared with the previous line><remainder>". That
roughly halves the payload for a file that ships inside a single-page tool.

  python tools/bake_names.py            # -> data/asset_names.txt
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "..", "..", "Desktop", "Mercs2_Decompiled_Lua",
                   "docs", "mercs2-luacd", "wad_reference", "all_asset_names.txt")
OUT = os.path.join(HERE, "..", "data", "asset_names.txt")

names = sorted({l.strip() for l in open(SRC, encoding="utf8", errors="ignore") if l.strip()})
lines, prev = [], ""
for n in names:
    i = 0
    while i < len(prev) and i < len(n) and i < 90 and prev[i] == n[i]:
        i += 1
    lines.append(chr(48 + i) + n[i:])          # shared count as a printable char
    prev = n
os.makedirs(os.path.dirname(OUT), exist_ok=True)
blob = "\n".join(lines)
open(OUT, "w", encoding="utf8", newline="").write(blob)
raw = sum(len(n) + 1 for n in names)
print("%d names: %d B raw -> %d B front-coded (%.0f%%)" % (len(names), raw, len(blob), 100 * len(blob) / raw))
