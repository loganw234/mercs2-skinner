// Minimal STORE-only ZIP writer.
//
// A modkit mod is a folder (definition + PNGs), and handing the user four separate
// downloads is worse than one archive. Everything stored uncompressed: PNG is already
// deflated, so compressing again buys nothing and would need a deflate implementation.

/** Standard CRC-32 (init 0xFFFFFFFF, final inversion) -- NOT crc32Mercs2, which is the
 *  raw register with no inversion. ZIP wants the standard one. */
const T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = (T[(c ^ b[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {Array<{name:string, data:Uint8Array}>} files */
export function makeZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameB = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + nameB.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);            // version needed
    dv.setUint16(6, 0, true);             // flags
    dv.setUint16(8, 0, true);             // method 0 = store
    dv.setUint16(10, 0, true);            // time
    dv.setUint16(12, 0x21, true);         // date (1980-01-01; deterministic output)
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, nameB.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    locals.push(lh, f.data);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    central.push(ch);

    offset += lh.length + f.data.length;
  }

  let centralLen = 0;
  for (const c of central) centralLen += c.length;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralLen, true);
  ev.setUint32(16, offset, true);

  let total = offset + centralLen + 22;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of locals) { out.set(p, o); o += p.length; }
  for (const c of central) { out.set(c, o); o += c.length; }
  out.set(end, o);
  return out;
}
