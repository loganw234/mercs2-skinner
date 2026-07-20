// Clone a model container, repointing its texture references. Reskin only, no geometry.
//
// This is a port of tools/repoint_model.py, and it exists to delete a step. The additive
// export used to hand people a shell script whose first line was `python repoint_model.py
// …`, which means the "add a new outfit" path -- the one that cannot damage your game and
// so should be the EASIEST -- demanded a Python install before it would do anything. The
// whole operation is a few hundred bytes of edits, so there is no reason it cannot happen
// in the browser where the donor bytes already are.
//
// WHAT IT TOUCHES: only 4-byte texture hashes inside the MTRL chunk, then the container's
// trailing CSUM. Every other byte -- HIER, SEGM, GEOM, the vertex streams -- is copied
// verbatim, which is what makes it safe: a reskin has no business editing geometry.
//
// The asset's own identity is NOT in the container; it comes from the ASET row that the
// packer declares, so the clone needs no name patch.

import { crc32Mercs2 } from './texture.js';

const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const putU32 = (b, o, v) => {
  b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
};

/** (start, end) of the MTRL chunk, in FILE coordinates. */
export function mtrlSpan(b) {
  if (tag(b, 0) !== 'UCFX') throw new Error('Not a UCFX container.');
  const base = u32(b, 4);
  const n = u32(b, 16);
  for (let r = 0; r < n; r++) {
    const o = 20 + r * 20;
    if (tag(b, o) === 'MTRL') {
      const off = u32(b, o + 4);
      const sz = u32(b, o + 8);
      return [base + off, base + off + sz];
    }
  }
  throw new Error('No MTRL chunk — this container declares no materials.');
}

/**
 * @param {Uint8Array} src   the donor container, verbatim from the bundle's raw/ folder
 * @param {Array<{from:number,to:number}>} pairs
 * @returns {{bytes: Uint8Array, counts: Array<{from:number,to:number,n:number}>}}
 */
export function repointModel(src, pairs) {
  const d = Uint8Array.from(src);
  if (d.length < 16) throw new Error('Container is too small to be a model.');
  if (tag(d, d.length - 8) !== 'CSUM') throw new Error('Container does not end with CSUM.');

  // Verify BEFORE editing. If the donor's own checksum does not reproduce, our idea of the
  // format is wrong somewhere, and silently writing a container we cannot account for is
  // how you ship something that crashes on load.
  const want = u32(d, d.length - 4);
  const got = crc32Mercs2(d.subarray(0, d.length - 8));
  if (got !== want) {
    throw new Error('Donor CSUM does not verify — refusing to edit a container we cannot '
      + `reproduce (stored ${hex(want)}, computed ${hex(got)}).`);
  }

  const [lo, hi] = mtrlSpan(d);
  const counts = [];
  for (const { from, to } of pairs) {
    const pat = [from & 0xff, (from >>> 8) & 0xff, (from >>> 16) & 0xff, (from >>> 24) & 0xff];
    let n = 0;
    for (let i = lo; i + 4 <= hi; i++) {
      if (d[i] === pat[0] && d[i + 1] === pat[1] && d[i + 2] === pat[2] && d[i + 3] === pat[3]) {
        putU32(d, i, to);
        i += 3;
        n++;
      }
    }
    // A zero-match repoint means the donor and the edit disagree about what this model
    // uses. Carrying on would produce a container that looks fine and renders the original
    // textures, which is far harder to diagnose than a refusal here.
    if (!n) {
      throw new Error(`${hex(from)} does not appear in this model's materials — wrong donor, `
        + 'or that texture is not one this model uses.');
    }
    counts.push({ from, to, n });
  }

  putU32(d, d.length - 4, crc32Mercs2(d.subarray(0, d.length - 8)));

  // Re-verify rather than trusting the write.
  if (d.length !== src.length) throw new Error('Size changed — geometry was disturbed.');
  if (crc32Mercs2(d.subarray(0, d.length - 8)) !== u32(d, d.length - 4)) {
    throw new Error('CSUM did not take.');
  }
  return { bytes: d, counts };
}

const hex = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
