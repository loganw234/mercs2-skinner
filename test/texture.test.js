// The load-bearing test: src/texture.js must reproduce the community project's
// dds_to_ucfx_texture.py byte for byte. That script reverse-engineered the container
// layout and the fully-resident INFO flags, so it -- not this port -- is the spec.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildUcfxTexture, readDdsRgb, crc32Mercs2, mipCount, mipChainSize, dxt1Compress, boxDown, isPow2 } from '../src/texture.js';

const FIX = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

export function run(t) {
  // The primary fixture is SYNTHETIC (tools/make_synthetic_fixture.py) rather than game
  // art, so byte-parity is checked on a fresh clone with nothing extracted committed.
  // It is built to be hostile to a block compressor: smooth ramps, hard checker edges,
  // noise, and flat blocks -- the four cases where encoders diverge.
  const dds = readFileSync(join(FIX, 'synthetic.dds'));
  const { width, height, rgb } = readDdsRgb(ab(dds));
  t.eq('synthetic fixture is 256x256', `${width}x${height}`, '256x256');
  t.eq('mip count for 256', mipCount(width, height), 7);
  t.eq('mip chain size for 256 DXT1', mipChainSize(width, height), 43688);

  const got = buildUcfxTexture({ width, height, rgb, name: 'synthetic_diffuse' });
  const want = readFileSync(join(FIX, 'synthetic_container.expected.bin'));
  t.eq('container size', got.length, want.length);
  let diff = 0, first = -1;
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) { diff++; if (first < 0) first = i; }
  t.ok('UCFX container is BYTE-IDENTICAL to dds_to_ucfx_texture.py', diff === 0,
    `${diff} bytes differ, first at ${first}: got ${got[first]} want ${want[first]}`);

  // Header invariants the engine actually reads.
  const dv = new DataView(ab(Buffer.from(got)));
  t.eq('magic', String.fromCharCode(...got.subarray(0, 4)), 'UCFX');
  t.eq('descriptor count', dv.getUint32(16, true), 3);
  const body = got.subarray(80);
  t.eq('INFO declares DXT1', String.fromCharCode(...findInfo(got).subarray(14, 18)), 'DXT1');
  const info = findInfo(got);
  const idv = new DataView(ab(Buffer.from(info)));
  t.eq('INFO width', idv.getUint16(0, true), 256);
  t.eq('INFO mips', idv.getUint16(6, true), 7);
  t.eq('INFO total_size == body length', idv.getUint32(22, true), 43688);
  t.ok('INFO[26:32] is zero (fully resident, no streaming)',
    info.subarray(26, 32).every((b) => b === 0));
  t.eq('resident sentinel 0xFFFF', idv.getUint16(32, true), 0xffff);
  t.eq('trailer is CSUM', String.fromCharCode(...got.subarray(got.length - 8, got.length - 4)), 'CSUM');

  // A wrong BODY length is the documented BUFFER_TOO_SMALL over-read, so pin the rule.
  t.eq('mipChainSize matches what was actually written', mipChainSize(256, 256), idv.getUint32(22, true));

  // Guards
  t.throws('non-power-of-two is rejected',
    () => buildUcfxTexture({ width: 100, height: 64, rgb: new Float32Array(100 * 64 * 3), name: 'x' }),
    /power-of-two/);
  t.ok('isPow2', isPow2(256) && isPow2(1024) && !isPow2(255) && !isPow2(0));

  // Deterministic: same input twice -> same bytes.
  const again = buildUcfxTexture({ width, height, rgb, name: 'synthetic_diffuse' });
  let same = got.length === again.length;
  for (let i = 0; same && i < got.length; i++) if (got[i] !== again[i]) same = false;
  t.ok('encoding is deterministic', same);

  // A flat block must stay in 4-colour opaque mode (c0 > c1), not tip into DXT1's
  // 3-colour + transparent interpretation.
  const flat = new Float32Array(4 * 4 * 3).fill(0);
  const blk = dxt1Compress(flat, 4, 4);
  const c0 = blk[0] | (blk[1] << 8), c1 = blk[2] | (blk[3] << 8);
  t.ok(`flat black block stays opaque (c0=${c0} > c1=${c1})`, c0 > c1);

  // box_down is exact on integers -- the property that keeps float32/float64 agreeing.
  const src = new Float32Array([0, 0, 0, 4, 4, 4, 8, 8, 8, 12, 12, 12]);
  const down = boxDown(src, 2, 2);
  t.eq('boxDown averages a 2x2 exactly', down[0], 6);

  t.eq('crc32Mercs2 of empty input', crc32Mercs2(new Uint8Array(0)), 0);

  // Second case at a different size/mip depth, from a real game sheet. Not committed
  // (extracted art), so it skips on a fresh clone.
  if (existsSync(join(FIX, 'ref.dds'))) {
    const d2 = readFileSync(join(FIX, 'ref.dds'));
    const r2 = readDdsRgb(ab(d2));
    const g2 = buildUcfxTexture({ width: r2.width, height: r2.height, rgb: r2.rgb, name: 'myskin_diffuse' });
    const w2 = readFileSync(join(FIX, 'ref_container.expected.bin'));
    let n2 = 0;
    for (let i = 0; i < w2.length; i++) if (g2[i] !== w2[i]) n2++;
    t.ok(`1024x1024 / 9-mip game sheet is byte-identical too (${g2.length} bytes)`,
      n2 === 0 && g2.length === w2.length, `${n2} bytes differ`);
  } else {
    t.skip('1024x1024 game-sheet parity (optional second size)',
      'python tools/reference-python/png_to_dds.py <exported tex>.png test/fixtures/ref.dds && python tools/reference-python/dds_to_ucfx_texture.py test/fixtures/ref.dds myskin_diffuse test/fixtures/ref_container.expected.bin');
  }
}

function findInfo(c) {
  const dv = new DataView(c.buffer, c.byteOffset, c.byteLength);
  for (let r = 0; r < 3; r++) {
    const o = 20 + r * 20;
    const tag = String.fromCharCode(c[o], c[o + 1], c[o + 2], c[o + 3]);
    if (tag === 'INFO') {
      const off = dv.getUint32(o + 4, true), sz = dv.getUint32(o + 8, true);
      return c.subarray(80 + off, 80 + off + sz);
    }
  }
  throw new Error('no INFO chunk');
}
