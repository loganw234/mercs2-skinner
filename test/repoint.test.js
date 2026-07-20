// Model repointing: clone a container, swap its texture references, nothing else.
//
// The fixture is synthetic so a fresh clone can run this with no game art committed. It is
// built to catch the mistake that matters most: replacing a 4-byte pattern everywhere it
// happens to occur instead of only inside MTRL. A model container is mostly vertex data,
// and four bytes of geometry WILL coincide with a texture hash eventually -- a global
// search-and-replace corrupts the mesh in a way that only shows up in game.

import { repointModel, mtrlSpan } from '../src/repoint.js';
import { crc32Mercs2 } from '../src/texture.js';

const put32 = (b, o, v) => {
  b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
};
const putTag = (b, o, s) => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); };
const get32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

const A = 0x98529145;   // "upper body" texture
const B = 0x87F9725E;   // "lower body" texture

/** A container with a HIER chunk and an MTRL chunk. The HIER chunk deliberately contains
 *  the SAME 4-byte value as one of the material hashes -- that is the trap. */
function container() {
  const ROWS = 2;
  const base = 20 + ROWS * 20;
  const hier = 32;        // bytes of "geometry"
  const mtrl = 24;
  const body = hier + mtrl;
  const b = new Uint8Array(base + body + 8);

  putTag(b, 0, 'UCFX');
  put32(b, 4, base);
  put32(b, 16, ROWS);
  putTag(b, 20, 'HIER'); put32(b, 24, 0); put32(b, 28, hier);
  putTag(b, 40, 'MTRL'); put32(b, 44, hier); put32(b, 48, mtrl);

  // HIER payload: filler with A planted in the middle, which must survive untouched.
  for (let i = 0; i < hier; i++) b[base + i] = (i * 7) & 0xff;
  put32(b, base + 12, A);

  // MTRL payload: A once, B twice.
  const m = base + hier;
  put32(b, m + 0, A);
  put32(b, m + 8, B);
  put32(b, m + 16, B);

  putTag(b, b.length - 8, 'CSUM');
  put32(b, b.length - 4, crc32Mercs2(b.subarray(0, b.length - 8)));
  return b;
}

export function run(t) {
  const src = container();
  const base = 20 + 2 * 20;

  t.deepEq('MTRL span is located', mtrlSpan(src), [base + 32, base + 32 + 24]);

  const { bytes, counts } = repointModel(src, [
    { from: A, to: 0xB0D49D73 },
    { from: B, to: 0x746D5076 },
  ]);

  t.eq('the single MTRL reference to A is repointed', counts[0].n, 1);
  t.eq('both MTRL references to B are repointed', counts[1].n, 2);
  t.eq('size is unchanged', bytes.length, src.length);

  // ★ the trap: the copy of A sitting in HIER must be untouched
  t.eq('a matching value OUTSIDE MTRL is left alone', get32(bytes, base + 12), A);

  const m = base + 32;
  t.eq('MTRL slot 0 rewritten', get32(bytes, m + 0), 0xB0D49D73);
  t.eq('MTRL slot 1 rewritten', get32(bytes, m + 8), 0x746D5076);
  t.eq('MTRL slot 2 rewritten', get32(bytes, m + 16), 0x746D5076);

  // every byte outside MTRL and the checksum is byte-for-byte the donor
  let strayEdits = 0;
  for (let i = 0; i < bytes.length - 8; i++) {
    if (i >= m && i < m + 24) continue;
    if (bytes[i] !== src[i]) strayEdits++;
  }
  t.eq('no byte outside MTRL was modified', strayEdits, 0);

  t.eq('CSUM is recomputed and valid',
    crc32Mercs2(bytes.subarray(0, bytes.length - 8)), get32(bytes, bytes.length - 4));
  t.ok('CSUM actually changed', get32(bytes, bytes.length - 4) !== get32(src, src.length - 4));

  t.ok('the source buffer is not mutated', get32(src, m + 0) === A);

  // --- refusals. Each of these is a case where carrying on produces a container that
  // looks fine and behaves wrongly, which is far worse than an error.
  t.throws('a hash the model does not use is refused',
    () => repointModel(src, [{ from: 0xDEADBEEF, to: 1 }]), /does not appear/);

  const bad = Uint8Array.from(src);
  bad[base + 1] ^= 0xff;                       // corrupt a geometry byte
  t.throws('a donor whose own CSUM does not verify is refused',
    () => repointModel(bad, [{ from: A, to: 1 }]), /CSUM does not verify/);

  const notUcfx = Uint8Array.from(src);
  putTag(notUcfx, 0, 'NOPE');
  put32(notUcfx, notUcfx.length - 4, crc32Mercs2(notUcfx.subarray(0, notUcfx.length - 8)));
  t.throws('a non-UCFX file is refused', () => repointModel(notUcfx, [{ from: A, to: 1 }]),
    /Not a UCFX/);

  const noMtrl = Uint8Array.from(src);
  putTag(noMtrl, 40, 'JUNK');
  put32(noMtrl, noMtrl.length - 4, crc32Mercs2(noMtrl.subarray(0, noMtrl.length - 8)));
  t.throws('a container with no materials is refused',
    () => repointModel(noMtrl, [{ from: A, to: 1 }]), /No MTRL/);

  const short = new Uint8Array(4);
  t.throws('a truncated file is refused', () => repointModel(short, []), /too small|CSUM/);
}
