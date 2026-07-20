#!/usr/bin/env python3
"""Append new model entries INTO an existing WAD block, so they inherit its LOD chain.

WHY: `mercs2_smuggler --inject-extra` gives a new asset a hash but no PATH, and the engine
locates a model's finer LOD rungs (`_P001`) by path naming. A model injected that way is
therefore stranded on its resident block and renders at its coarsest tier at every distance
-- 639 triangles instead of 3,856 on civ_hum_beachfemale_a, with a visibly flattened face.

Logan's fix: don't create a lone block. Take the RESIDENT block that already exists, append
the new containers to it as extra sub-entries, and ship the whole thing back with
`--inject-block`, which preserves the block's path and ASET rows. The new models then live
at the same path as the original, so the `_P001` rungs resolve for them too.

Block layout (verified against block 2110 of vz.wad):

    [u32 entry_count]
    [entry_count x 16 bytes: name_hash, type_hash, field_c, size]
    [payloads, concatenated IN DIRECTORY ORDER]

Offsets are implicit, so appending to both the directory and the payload run is safe.

  python add_block_entry.py <block.bin> <out.bin> <0xHASH>:<container.ucfx> [more...]
"""
import struct
import sys

TYPE_MODEL = 0x5B724250      # pandemic_hash_m2("model")
TYPE_TEXTURE = 0xF011157A    # pandemic_hash_m2("texture")


def parse(block):
    n = struct.unpack_from("<I", block, 0)[0]
    rows, off = [], 4 + n * 16
    for i in range(n):
        nh, th, fc, sz = struct.unpack_from("<IIII", block, 4 + i * 16)
        rows.append({"name": nh, "type": th, "f": fc, "size": sz, "off": off})
        off += sz
    if off != len(block):
        raise SystemExit("block is %d bytes but entries account for %d -- not a raw block?"
                         % (len(block), off))
    return rows


def build(rows, payloads):
    out = bytearray(struct.pack("<I", len(rows)))
    for r in rows:
        out += struct.pack("<IIII", r["name"], r["type"], r["f"], r["size"])
    for p in payloads:
        out += p
    return bytes(out)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    block = open(src, "rb").read()
    rows = parse(block)
    payloads = [block[r["off"]:r["off"] + r["size"]] for r in rows]
    print("  %s: %d entries, %d bytes" % (src, len(rows), len(block)))

    existing = {r["name"] for r in rows}
    for spec in sys.argv[3:]:
        h, path = spec.split(":", 1)
        name_hash = int(h, 16) & 0xFFFFFFFF
        data = open(path, "rb").read()
        if data[:4] != b"UCFX":
            raise SystemExit("%s is not a UCFX container" % path)
        if name_hash in existing:
            # Overwriting an existing entry silently would replace a real asset, which is
            # the opposite of additive. Refuse.
            raise SystemExit("0x%08X already exists in this block -- pick another name"
                             % name_hash)
        rows.append({"name": name_hash, "type": TYPE_MODEL, "f": 0, "size": len(data)})
        payloads.append(data)
        existing.add(name_hash)
        print("  + 0x%08X  %-40s %d bytes" % (name_hash, path.split("/")[-1], len(data)))

    out = build(rows, payloads)
    open(dst, "wb").write(out)

    # Re-parse the result rather than trusting the writer.
    back = parse(out)
    assert len(back) == len(rows), "entry count mismatch after rebuild"
    for a, b in zip(rows, back):
        assert a["name"] == b["name"] and a["size"] == b["size"], "row drifted"
    for i, p in enumerate(payloads):
        assert out[back[i]["off"]:back[i]["off"] + back[i]["size"]] == p, \
            "payload %d moved or corrupted" % i
    print("  wrote %s: %d entries, %d bytes (re-parsed and verified)"
          % (dst, len(back), len(out)))


if __name__ == "__main__":
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    main()
