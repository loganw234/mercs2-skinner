#!/usr/bin/env python3
"""Clone a model container, repointing its texture references -- reskin only, no geometry.

WHY THIS EXISTS: `inject_parts --repoint` looked like the tool for this, but it REQUIRES at
least one `--part`, so it cannot express "same mesh, different textures". Round-tripping the
geometry through it just to satisfy the flag would risk changing the mesh for a job that
touches no vertices. Nothing else published does a repoint-only clone, so this does the one
thing needed.

WHAT IT TOUCHES: only 4-byte texture hashes inside the MTRL chunk, then the container's
trailing CSUM. Every other byte -- HIER, SEGM, GEOM, the vertex streams -- is copied
verbatim, which is what makes this safe: a reskin has no business editing geometry.

The asset's own identity is NOT in the container; it comes from the ASET row that
`mercs2_smuggler --inject-extra <hash>:19:<file>` declares, so the clone needs no name patch.

  python repoint_model.py <donor.ucfx> <out.ucfx> 0xOLD:0xNEW [0xOLD:0xNEW ...]
"""
import struct
import sys
import zlib


def crc32_mercs2(b):
    """Raw CRC32 register with no final inversion -- what the container trailer stores."""
    return (zlib.crc32(b, 0xFFFFFFFF) ^ 0xFFFFFFFF) & 0xFFFFFFFF


def mtrl_span(d):
    """(start, end) of the MTRL chunk in FILE coordinates."""
    if d[:4] != b"UCFX":
        raise SystemExit("not a UCFX container")
    base = struct.unpack_from("<I", d, 4)[0]
    n = struct.unpack_from("<I", d, 16)[0]
    for r in range(n):
        o = 20 + r * 20
        if d[o:o + 4] == b"MTRL":
            off, sz = struct.unpack_from("<II", d, o + 4)
            return base + off, base + off + sz
    raise SystemExit("no MTRL chunk -- this container declares no materials")


def repoint(src, dst, pairs):
    d = bytearray(open(src, "rb").read())
    if d[-8:-4] != b"CSUM":
        raise SystemExit("container does not end with CSUM")
    if crc32_mercs2(bytes(d[:-8])) != struct.unpack_from("<I", d, len(d) - 4)[0]:
        raise SystemExit("donor CSUM does not verify -- refusing to edit a container we "
                         "cannot reproduce")
    lo, hi = mtrl_span(d)
    total = 0
    for old, new in pairs:
        pat, rep = struct.pack("<I", old), struct.pack("<I", new)
        i, n = lo, 0
        while True:
            i = d.find(pat, i, hi)
            if i < 0:
                break
            d[i:i + 4] = rep
            i += 4
            n += 1
        if n == 0:
            raise SystemExit("0x%08X does not appear in MTRL -- wrong donor, or that "
                             "texture is not used by this model" % old)
        print("  0x%08X -> 0x%08X   (%d reference%s)" % (old, new, n, "" if n == 1 else "s"))
        total += n
    struct.pack_into("<I", d, len(d) - 4, crc32_mercs2(bytes(d[:-8])))
    open(dst, "wb").write(d)

    # Re-read and re-verify rather than trusting the write.
    chk = open(dst, "rb").read()
    assert len(chk) == len(open(src, "rb").read()), "size changed -- geometry was disturbed"
    assert crc32_mercs2(chk[:-8]) == struct.unpack_from("<I", chk, len(chk) - 4)[0], "CSUM bad"
    print("  wrote %s (%d bytes, %d references repointed, CSUM re-verified)"
          % (dst, len(chk), total))


if __name__ == "__main__":
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    pairs = []
    for a in sys.argv[3:]:
        o, n = a.split(":")
        pairs.append((int(o, 16), int(n, 16)))
    repoint(sys.argv[1], sys.argv[2], pairs)
