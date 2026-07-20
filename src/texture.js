// Mercenaries 2 UCFX texture container writer.
//
// Port of the community project's `dds_to_ucfx_texture.py` (bundled for reference in
// tools/reference-python/). That script is the SPECIFICATION -- test/texture.test.js
// asserts this produces a byte-identical container -- because the byte layout was
// reverse-engineered there, not here.
//
// The container is deliberately FULLY RESIDENT: INFO[26:32] = 0 plus the 0xFFFF sentinel
// tells the engine not to stream the texture, and BODY is exactly the dimension-derived
// mip chain. Getting that size wrong triggers a BUFFER_TOO_SMALL over-read in the
// streaming path (documented in mercs2_formats::texsize), which is why the size is
// derived rather than taken from the source file.

/** CRC32 as Mercs2 uses it: the raw LFSR register starting at 0, with NO final inversion.
 *  (Python `zlib.crc32(d, 0xFFFFFFFF) ^ 0xFFFFFFFF` reduces to exactly this.) */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32Mercs2(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return crc >>> 0;
}

const to565 = (r, g, b) =>
  (((Math.round(r) >> 3) & 0x1f) << 11) | (((Math.round(g) >> 2) & 0x3f) << 5) | ((Math.round(b) >> 3) & 0x1f);

function from565(v) {
  const r = (v >> 11) & 0x1f, g = (v >> 5) & 0x3f, b = v & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** One 4x4 RGB block -> 8 bytes of DXT1, opaque 4-colour mode.
 *  `blk` is 48 floats, row-major, 3 channels. */
function dxt1Block(blk, out, o) {
  let minR = Infinity, minG = Infinity, minB = Infinity;
  let maxR = -Infinity, maxG = -Infinity, maxB = -Infinity;
  for (let i = 0; i < 16; i++) {
    const r = blk[i * 3], g = blk[i * 3 + 1], b = blk[i * 3 + 2];
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (g < minG) minG = g; if (g > maxG) maxG = g;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }
  let c0 = to565(maxR, maxG, maxB);
  let c1 = to565(minR, minG, minB);
  if (c0 === c1) {
    // Flat block: keep c0 > c1 so we stay in 4-colour (opaque) mode rather than
    // falling into DXT1's 3-colour + transparent interpretation.
    if (c1 === 0) c0 = 1; else c1 = c0 - 1;
  }
  if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
  const e0 = from565(c0), e1 = from565(c1);
  // fround: numpy builds this palette in float32, and the /3 is inexact. Matching the
  // precision keeps argmin from tipping the other way on near-equidistant pixels.
  const f = Math.fround;
  const pal = [
    e0,
    e1,
    [f(f(f(2 * e0[0]) + e1[0]) / 3), f(f(f(2 * e0[1]) + e1[1]) / 3), f(f(f(2 * e0[2]) + e1[2]) / 3)],
    [f(f(e0[0] + f(2 * e1[0])) / 3), f(f(e0[1] + f(2 * e1[1])) / 3), f(f(e0[2] + f(2 * e1[2])) / 3)],
  ];
  // 16 pixels x 2 bits = exactly 32. `bits` goes negative once pixel 15 sets bit 31;
  // that is harmless because every read below uses >>> (unsigned).
  let bits = 0;
  for (let i = 0; i < 16; i++) {
    const r = blk[i * 3], g = blk[i * 3 + 1], b = blk[i * 3 + 2];
    // Every step rounds to float32, matching numpy's dtype through the subtract, the
    // square and the 3-element reduction. Doing this in float64 picks a different
    // palette entry for pixels sitting near the midpoint of the two interpolated
    // colours -- 90 bytes out of 699,188 on the reference image. Ties go to the first
    // minimum, as np.argmin does.
    let best = 0, bd = Infinity;
    for (let p = 0; p < 4; p++) {
      const dr = f(r - pal[p][0]), dg = f(g - pal[p][1]), db = f(b - pal[p][2]);
      const d = f(f(f(dr * dr) + f(dg * dg)) + f(db * db));
      if (d < bd) { bd = d; best = p; }
    }
    bits |= best << (2 * i);
  }
  out[o] = c0 & 0xff; out[o + 1] = (c0 >> 8) & 0xff;
  out[o + 2] = c1 & 0xff; out[o + 3] = (c1 >> 8) & 0xff;
  out[o + 4] = bits & 0xff; out[o + 5] = (bits >>> 8) & 0xff;
  out[o + 6] = (bits >>> 16) & 0xff; out[o + 7] = (bits >>> 24) & 0xff;
}

/** Whole-image DXT1. `rgb` is Float32Array of w*h*3. Partial edge blocks are zero-padded,
 *  matching the reference implementation. */
export function dxt1Compress(rgb, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  const out = new Uint8Array(bw * bh * 8);
  const blk = new Float32Array(48);
  let o = 0;
  for (let by = 0; by < h; by += 4) {
    for (let bx = 0; bx < w; bx += 4) {
      blk.fill(0);
      for (let y = 0; y < 4 && by + y < h; y++) {
        for (let x = 0; x < 4 && bx + x < w; x++) {
          const s = ((by + y) * w + (bx + x)) * 3;
          const d = (y * 4 + x) * 3;
          blk[d] = rgb[s]; blk[d + 1] = rgb[s + 1]; blk[d + 2] = rgb[s + 2];
        }
      }
      dxt1Block(blk, out, o);
      o += 8;
    }
  }
  return out;
}

/** 2x2 box filter. Values stay exactly representable through the whole chain (a 1024
 *  image's deepest mip needs 24 mantissa bits, exactly what float32 has), so this
 *  matches numpy bit for bit. */
export function boxDown(rgb, w, h) {
  const nw = w >> 1, nh = h >> 1;
  const out = new Float32Array(nw * nh * 3);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      for (let c = 0; c < 3; c++) {
        const a = rgb[((2 * y) * w + 2 * x) * 3 + c];
        const b = rgb[((2 * y + 1) * w + 2 * x) * 3 + c];
        const d = rgb[((2 * y) * w + 2 * x + 1) * 3 + c];
        const e = rgb[((2 * y + 1) * w + 2 * x + 1) * 3 + c];
        out[(y * nw + x) * 3 + c] = Math.fround((a + b + d + e) * 0.25);
      }
    }
  }
  return out;
}

export const mipCount = (w, h) => Math.max(1, (32 - Math.clz32(Math.min(w, h))) - 2);

/** Total DXT1 byte length of the full mip chain -- the value the engine's resident path
 *  expects BODY to be. */
export function mipChainSize(w, h) {
  let total = 0, cw = w, ch = h;
  for (let m = 0, n = mipCount(w, h); m < n; m++) {
    total += Math.ceil(cw / 4) * Math.ceil(ch / 4) * 8;
    cw >>= 1; ch >>= 1;
  }
  return total;
}

/**
 * Build a complete UCFX texture container.
 * @param {{width:number, height:number, rgb:Float32Array, name:string}} o
 *        `rgb` is w*h*3 floats in 0..255.
 * @returns {Uint8Array}
 */
export function buildUcfxTexture({ width, height, rgb, name }) {
  if (!isPow2(width) || !isPow2(height)) {
    throw new Error(`texture must be power-of-two, got ${width}x${height}`);
  }
  const mips = mipCount(width, height);
  const parts = [];
  let cur = rgb, cw = width, ch = height;
  for (let m = 0; m < mips; m++) {
    parts.push(dxt1Compress(cur, cw, ch));
    if (m < mips - 1) { cur = boxDown(cur, cw, ch); cw >>= 1; ch >>= 1; }
  }
  let bodyLen = 0;
  for (const p of parts) bodyLen += p.length;
  const body = new Uint8Array(bodyLen);
  let bo = 0;
  for (const p of parts) { body.set(p, bo); bo += p.length; }

  // NAME is NUL-terminated and padded to an even length.
  const nameBytes = new TextEncoder().encode(name);
  let nameLen = nameBytes.length + 1;
  if (nameLen % 2) nameLen++;
  const nameB = new Uint8Array(nameLen);
  nameB.set(nameBytes);

  const info = new Uint8Array(34);
  const iv = new DataView(info.buffer);
  iv.setUint16(0, width, true); iv.setUint16(2, height, true);
  iv.setUint16(4, 1, true); iv.setUint16(6, mips, true);
  iv.setUint16(8, 0, true); iv.setUint16(10, 1, true); iv.setUint16(12, 1, true);
  info.set(new TextEncoder().encode('DXT1'), 14);
  iv.setUint32(22, body.length, true);
  // info[26:32] stays zero = fully resident (no streaming)
  iv.setUint16(32, 0xffff, true);

  const rows = [['NAME', nameB, 2], ['INFO', info, 1], ['BODY', body, 0]];
  const dataOff = 20 + 3 * 20;
  const chunks = [];
  const placed = [];
  let blobLen = 0;
  for (const [tag, buf, u2] of rows) {
    while (blobLen % 4) { chunks.push(new Uint8Array(1)); blobLen++; }
    placed.push([tag, blobLen, buf.length, u2]);
    chunks.push(buf);
    blobLen += buf.length;
  }

  const total = dataOff + blobLen + 8;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('UCFX'), 0);
  dv.setUint32(4, dataOff, true); dv.setUint32(8, 0, true);
  dv.setUint32(12, 0, true); dv.setUint32(16, 3, true);
  let ro = 20;
  for (const [tag, off, sz, u2] of placed) {
    out.set(new TextEncoder().encode(tag), ro);
    dv.setUint32(ro + 4, off, true); dv.setUint32(ro + 8, sz, true);
    dv.setUint32(ro + 12, u2, true); dv.setUint32(ro + 16, 0, true);
    ro += 20;
  }
  let co = dataOff;
  for (const c of chunks) { out.set(c, co); co += c.length; }
  out.set(new TextEncoder().encode('CSUM'), co);
  dv.setUint32(co + 4, crc32Mercs2(out.subarray(0, co)), true);
  return out;
}

export const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/** Read an uncompressed BGRA .dds (128-byte header) -> {width, height, rgb}.
 *  Used by the tests to feed the exact pixels the reference script saw. */
export function readDdsRgb(buf) {
  const dv = new DataView(buf);
  const height = dv.getUint32(12, true);
  const width = dv.getUint32(16, true);
  const px = new Uint8Array(buf, 128);
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, n = width * height; i < n; i++) {
    rgb[i * 3] = px[i * 4 + 2];       // stored BGRA
    rgb[i * 3 + 1] = px[i * 4 + 1];
    rgb[i * 3 + 2] = px[i * 4];
  }
  return { width, height, rgb };
}
