// Outfit transfer: donor clothing re-laid-out into the target's UV space.
//
// The property that matters is NOT "some colour arrived" -- a filename swap achieves that
// too, and produces garbage. It is that colour arrives on the CORRECT BODY PART. So the
// fixture is a pair of characters built to be maximally hostile to a naive copy: same body
// in 3D, deliberately MIRRORED UV layouts. A filename swap scores ~0 on such a pair; a
// correct transfer scores ~1.

import {
  surfaceSamples, buildGrid, nearest, rasterizeUV, bodyBounds, alignment,
  dilate, transferOutfit, describeFit,
} from '../src/transfer.js';

/**
 * A "character": a vertical strip of quads wrapped as a tube, with one diffuse sheet.
 *
 * @param flip   lay the UVs out top-to-bottom instead of bottom-to-top
 * @param height overall body height, so the scale-alignment path gets exercised
 */
function makeChar(name, { flip = false, height = 1.8, rings = 12, seg = 8, size = 64 } = {}) {
  const position = [], uv = [], index = [];
  for (let r = 0; r <= rings; r++) {
    const fy = r / rings;
    for (let s = 0; s <= seg; s++) {
      const fs = s / seg;
      const a = fs * Math.PI * 2;
      position.push(Math.cos(a) * 0.2, fy * height, Math.sin(a) * 0.2);
      uv.push(fs, flip ? 1 - fy : fy);
    }
  }
  const w = seg + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const i = r * w + s;
      index.push(i, i + 1, i + w, i + 1, i + w + 1, i + w);
    }
  }
  const geom = {
    position: new Float32Array(position),
    uv: new Float32Array(uv),
    normal: new Float32Array(position.length),
    index: new Uint32Array(index),
  };
  const hash = '0x' + name;
  return {
    name,
    textures: [{ hash, roles: ['diffuse'], triangles: index.length / 3, width: size, height: size }],
    geometryFor: (h) => (h === hash ? geom : null),
    hash,
    size,
  };
}

/** Height-banded image: each vertical band a distinct hue. Which band a texel holds tells
 *  us which part of the BODY its colour came from. */
function bandedImage(size, flip) {
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const band = Math.floor((flip ? size - 1 - y : y) / (size / 4));   // 0..3 bottom->top
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      d[i] = band === 0 ? 255 : 0;
      d[i + 1] = band === 1 ? 255 : (band === 3 ? 255 : 0);
      d[i + 2] = band === 2 ? 255 : (band === 3 ? 255 : 0);
      d[i + 3] = 255;
    }
  }
  return { data: d, width: size, height: size };
}

const bandOf = (r, g, b) => (r > 128 && g < 128 ? 0 : g > 128 && b < 128 ? 1
  : b > 128 && g < 128 ? 2 : g > 128 && b > 128 ? 3 : -1);

export function run(t) {
  // ---------------------------------------------------------------- grid
  const pts = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 5, 5]);
  const g = buildGrid(pts, 5, 4);
  const probe = { d2: 0 };
  t.eq('nearest finds the exact point', nearest(g, 1, 0, 0, probe), 1);
  t.near('exact hit has zero distance', probe.d2, 0, 1e-9);
  t.eq('nearest finds the far outlier from far away', nearest(g, 6, 6, 6, probe), 4);
  t.eq('nearest resolves a point between candidates', nearest(g, 0.1, 0.9, 0.05, probe), 2);
  // brute-force agreement on a random cloud -- the ring-termination bound is easy to get
  // subtly wrong, and a wrong one degrades quality silently rather than throwing
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const N = 400;
  const cloud = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) cloud[i] = rnd() * 10 - 5;
  const gg = buildGrid(cloud, N, 12);
  let agree = 0;
  for (let q = 0; q < 60; q++) {
    const qx = rnd() * 12 - 6, qy = rnd() * 12 - 6, qz = rnd() * 12 - 6;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = cloud[i * 3] - qx, dy = cloud[i * 3 + 1] - qy, dz = cloud[i * 3 + 2] - qz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    if (nearest(gg, qx, qy, qz, probe) === bi) agree++;
  }
  t.eq('grid nearest matches brute force on 60 random queries', agree, 60);

  // ---------------------------------------------------------------- raster
  const A = makeChar('AAAA');
  const geom = A.geometryFor(A.hash);
  const { position, mask } = rasterizeUV(geom, 64, 64);
  let covered = 0;
  for (let i = 0; i < mask.length; i++) covered += mask[i];
  t.ok('UV rasterizer covers most of the sheet', covered > 64 * 64 * 0.9, `covered ${covered}/4096`);
  // a texel at v=0 must sit at the bottom of the body, v=1 at the top
  const yAt = (u, v) => position[((Math.round(v * 63)) * 64 + Math.round(u * 63)) * 3 + 1];
  t.ok('v=0 maps to the foot of the body', yAt(0.5, 0.02) < 0.2, `y=${yAt(0.5, 0.02)}`);
  t.ok('v=1 maps to the head of the body', yAt(0.5, 0.98) > 1.6, `y=${yAt(0.5, 0.98)}`);

  // ---------------------------------------------------------------- bounds + alignment
  const short = makeChar('BBBB', { height: 1.2 });
  t.near('body height is measured', bodyBounds(A).height, 1.8, 0.02);
  const al = alignment(A, short);
  // Deliberately NOT rescaled: on a shared rig the bind pose already aligns the bodies,
  // and height-matching measurably worsened the correspondence on real characters.
  t.eq('alignment does not rescale', al.scale, 1);
  t.deepEq('alignment is the identity map', al.toDonor(0.3, 1.8, -0.2), [0.3, 1.8, -0.2]);
  t.near('the height ratio is still reported', al.heightRatio, 1.8 / 1.2, 0.03);
  t.ok('a large height difference is flagged', al.heightMismatch);
  t.ok('same-height characters are not flagged', !alignment(A, makeChar('CCCC')).heightMismatch);
  // Percentile bounds must ignore stray geometry -- a raw bbox mis-measured a real
  // character by 6% because one sheet dipped below the floor.
  {
    const stray = makeChar('DDDD');
    const g = stray.geometryFor(stray.hash);
    g.position[1] = -5;                       // one rogue vertex far below the body
    t.near('stray geometry does not corrupt the measured height',
      bodyBounds(stray).height, 1.8, 0.05);
  }

  // ---------------------------------------------------------------- dilation
  {
    const W = 8, H = 8;
    const rgba = new Uint8ClampedArray(W * H * 4);
    const m = new Uint8Array(W * H);
    const c = 3 * W + 3;
    rgba[c * 4] = 200; rgba[c * 4 + 1] = 100; rgba[c * 4 + 2] = 50; rgba[c * 4 + 3] = 255;
    m[c] = 1;
    dilate(rgba, m, W, H, 1);
    const n = ((3 * W) + 4) * 4;
    t.eq('dilation bleeds colour into the neighbour', rgba[n], 200);
    t.ok('dilation sets alpha on filled texels', rgba[n + 3] === 255);
  }

  // ---------------------------------------------------------------- the real property
  // Donor and target share a body but have MIRRORED UV layouts: the donor paints its head
  // where the target paints its feet. A filename swap therefore puts the head band on the
  // feet. The transfer must undo that entirely.
  const target = makeChar('7777', { flip: false });
  const donor = makeChar('8888', { flip: true });
  const donorImages = new Map([[donor.hash, bandedImage(donor.size, true)]]);
  const targetSizes = new Map([[target.hash, { width: 64, height: 64 }]]);

  const { results, align } = transferOutfit({ target, donor, donorImages, targetSizes });
  t.eq('one sheet transferred', results.size, 1);
  const res = results.get(target.hash);
  t.ok('every covered texel found a donor point', res.stats.unmapped === 0,
    `unmapped=${res.stats.unmapped}`);
  t.ok('correspondence error is tiny on an identical body',
    res.stats.p99Pct < 3, `p99=${res.stats.p99Pct.toFixed(2)}% of body height`);

  // Score: for each texel, does its colour band correspond to the body height it sits at?
  const img = res.image;
  let right = 0, total = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const got = bandOf(img.data[i], img.data[i + 1], img.data[i + 2]);
      if (got < 0) continue;
      // target UV: v = y/64 runs foot->head, so the expected band is by height
      const want = Math.floor(y / 16);
      total++;
      if (got === want) right++;
    }
  }
  const acc = right / total;
  t.ok('transferred colour lands on the correct body height', acc > 0.9,
    `${(acc * 100).toFixed(1)}% of texels correct (${right}/${total})`);
  t.info(`transfer accuracy ${(acc * 100).toFixed(1)}% across ${total} texels`);

  // And the control: a naive filename swap on the same pair. This is what the feature
  // exists to avoid, so assert that it really is as bad as claimed.
  {
    const naive = bandedImage(64, true);       // donor sheet used verbatim
    let ok2 = 0, tot2 = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        const got = bandOf(naive.data[i], naive.data[i + 1], naive.data[i + 2]);
        if (got < 0) continue;
        tot2++;
        if (got === Math.floor(y / 16)) ok2++;
      }
    }
    const nacc = ok2 / tot2;
    t.ok('a naive filename swap is wrong on this pair', nacc < 0.1,
      `naive accuracy ${(nacc * 100).toFixed(1)}%`);
    t.info(`naive swap accuracy ${(nacc * 100).toFixed(1)}% -- transfer beats it by ${((acc - nacc) * 100).toFixed(0)} points`);
  }

  // ---------------------------------------------------------------- sampling + fit text
  const s = surfaceSamples(donor);
  t.ok('surface samples include vertices and interior points', s.count > donor.textures[0].triangles * 3,
    `count=${s.count}`);
  t.ok('sample arrays are consistent', s.pos.length === s.count * 3 && s.uv.length === s.count * 2);
  t.eq('a tight fit reads as ok', describeFit({ p99Pct: 1 }, align).level, 'ok');
  t.eq('a loose fit warns', describeFit({ p99Pct: 8 }, align).level, 'warn');
  t.eq('a hopeless fit is called bad', describeFit({ p99Pct: 30 }, align).level, 'bad');

  // Determinism: the same swap twice must give identical bytes, or a reported result is
  // not reproducible and a visual diff is meaningless.
  const again = transferOutfit({ target, donor, donorImages, targetSizes });
  const a1 = res.image.data, a2 = again.results.get(target.hash).image.data;
  let same = true;
  for (let i = 0; i < a1.length; i++) if (a1[i] !== a2[i]) { same = false; break; }
  t.ok('the transfer is deterministic', same);
}
