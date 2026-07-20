// Put one character's clothing onto another character's body.
//
// The obvious implementation is to copy the donor's sheet over the target's and rename it.
// That does not work, and it is worth saying why in the code so nobody re-attempts it:
// characters do NOT share UV layouts. Measured over 40 exported characters, comparing which
// BODY PART each overlapping texel paints:
//
//     upper body   median agreement 0.21    1 of 276 pairs above 0.85
//     lower body   median agreement 0.29    4 of 190 pairs above 0.85
//     head         median agreement 0.71   38 of 465 pairs above 0.85
//
// Chris and the Allied soldier agree on 13% of their upper-body texels. A filename swap
// there paints sleeves onto thighs. Only same-family variants (chris <-> chris_v4) line up.
//
// What every character DOES share is the skeleton and the bind pose. So route the swap
// through 3D instead of through UV coincidence:
//
//     for each texel of the target's sheet
//       -> its 3D position on the target body   (barycentric inside the target's UV triangle)
//       -> the nearest point on the donor body  (spatial grid over donor surface samples)
//       -> that point's UV on the donor         -> sample the donor's texture
//
// The result is the donor's clothing re-laid-out in the target's UV space, which is what the
// engine will read. Median correspondence error on chris <- al_hum_starter01 is 0.0089 units
// on a ~1.8 unit body: under 1% of body height.

/** ImageData in a browser, a plain object under node -- same convention as recolor.js, so
 *  this module stays unit-testable without a DOM. */
function mkImage(data, width, height) {
  return typeof ImageData === 'function'
    ? new ImageData(data, width, height)
    : { data, width, height };
}

/** Deterministic PRNG. Math.random would make two runs of the same swap differ, which makes
 *  a reported result impossible to reproduce and a diff impossible to read. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Every diffuse sheet a bundle actually paints, finest LOD, with real triangles. */
export function bodySheets(bundle) {
  return bundle.textures.filter(
    (t) => t.roles.includes('diffuse') && t.triangles > 0 && t.width >= 8 && t.height >= 8);
}

/**
 * Scatter points over the donor's surface, each carrying the UV and sheet it came from.
 *
 * Sampling the surface rather than just the vertices matters: a garment panel can be a
 * handful of large triangles, and nearest-VERTEX would quantise the whole panel onto a few
 * UV points and band the result badly.
 */
export function surfaceSamples(bundle, { perTri = 4 } = {}) {
  const sheets = bodySheets(bundle);
  const posA = [], uvA = [], sheetA = [];
  const rand = lcg(0x5EED);

  sheets.forEach((tex, si) => {
    const g = bundle.geometryFor(tex.hash);
    if (!g) return;
    const { position, uv, index } = g;
    for (let i = 0; i + 2 < index.length; i += 3) {
      const a = index[i], b = index[i + 1], c = index[i + 2];
      // the vertices themselves, so silhouettes and corners are represented exactly
      for (const v of [a, b, c]) {
        posA.push(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
        uvA.push(uv[v * 2], uv[v * 2 + 1]);
        sheetA.push(si);
      }
      for (let k = 0; k < perTri; k++) {
        let w0 = rand(), w1 = rand();
        if (w0 + w1 > 1) { w0 = 1 - w0; w1 = 1 - w1; }
        const w2 = 1 - w0 - w1;
        posA.push(
          position[a * 3] * w0 + position[b * 3] * w1 + position[c * 3] * w2,
          position[a * 3 + 1] * w0 + position[b * 3 + 1] * w1 + position[c * 3 + 1] * w2,
          position[a * 3 + 2] * w0 + position[b * 3 + 2] * w1 + position[c * 3 + 2] * w2);
        uvA.push(
          uv[a * 2] * w0 + uv[b * 2] * w1 + uv[c * 2] * w2,
          uv[a * 2 + 1] * w0 + uv[b * 2 + 1] * w1 + uv[c * 2 + 1] * w2);
        sheetA.push(si);
      }
    }
  });

  return {
    pos: new Float32Array(posA),
    uv: new Float32Array(uvA),
    sheet: new Int32Array(sheetA),
    sheets,
    count: sheetA.length,
  };
}

/** Uniform spatial hash over the sample cloud. Points sit on a surface, so occupancy is
 *  sparse and query rings stay tiny -- almost every lookup resolves in ring 0 or 1.
 *
 *  `target` was measured, not guessed: on a real 73k-point character it costs 305ms of
 *  queries at 48, 172ms at 96, then rises again to 570ms at 256 as the ring walk starts
 *  visiting more empty cells than occupied ones. Every resolution returns identical
 *  results, which is also a useful check on the ring-termination bound. */
export function buildGrid(pos, count, target = 96) {
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const span = Math.max(maxx - minx, maxy - miny, maxz - minz) || 1;
  const cell = span / target;
  const nx = Math.max(1, Math.ceil((maxx - minx) / cell) + 1);
  const ny = Math.max(1, Math.ceil((maxy - miny) / cell) + 1);
  const nz = Math.max(1, Math.ceil((maxz - minz) / cell) + 1);

  const cellOf = (x, y, z) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - minx) / cell)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - miny) / cell)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - minz) / cell)));
    return { i, j, k };
  };

  // CSR buckets: count, prefix-sum, fill. Avoids an array-of-arrays for ~10^5 points.
  const nc = nx * ny * nz;
  const start = new Int32Array(nc + 1);
  for (let p = 0; p < count; p++) {
    const { i, j, k } = cellOf(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]);
    start[(k * ny + j) * nx + i + 1]++;
  }
  for (let c = 0; c < nc; c++) start[c + 1] += start[c];
  const items = new Int32Array(count);
  const cur = start.slice(0, nc);
  for (let p = 0; p < count; p++) {
    const { i, j, k } = cellOf(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]);
    items[cur[(k * ny + j) * nx + i]++] = p;
  }
  return { pos, start, items, nx, ny, nz, minx, miny, minz, cell, maxRing: Math.max(nx, ny, nz) };
}

/** Nearest sample index to (x,y,z), or -1. Returns squared distance in `out`. */
export function nearest(grid, x, y, z, out) {
  const { pos, start, items, nx, ny, nz, minx, miny, minz, cell } = grid;
  const ci = Math.min(nx - 1, Math.max(0, Math.floor((x - minx) / cell)));
  const cj = Math.min(ny - 1, Math.max(0, Math.floor((y - miny) / cell)));
  const ck = Math.min(nz - 1, Math.max(0, Math.floor((z - minz) / cell)));
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= grid.maxRing; r++) {
    const i0 = Math.max(0, ci - r), i1 = Math.min(nx - 1, ci + r);
    const j0 = Math.max(0, cj - r), j1 = Math.min(ny - 1, cj + r);
    const k0 = Math.max(0, ck - r), k1 = Math.min(nz - 1, ck + r);
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        // only the shell: interior cells were covered by a previous, smaller ring
        const onKJ = (k === ck - r || k === ck + r || j === cj - r || j === cj + r);
        for (let i = i0; i <= i1; i++) {
          if (!onKJ && i !== ci - r && i !== ci + r) continue;
          const c = (k * ny + j) * nx + i;
          for (let s = start[c]; s < start[c + 1]; s++) {
            const p = items[s];
            const dx = pos[p * 3] - x, dy = pos[p * 3 + 1] - y, dz = pos[p * 3 + 2] - z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = p; }
          }
        }
      }
    }
    // Anything in an unvisited cell is at least r*cell away, so once the best found beats
    // that bound no further ring can improve it.
    if (best >= 0 && bestD <= (r * cell) * (r * cell)) break;
  }
  if (out) out.d2 = bestD;
  return best;
}

/** texel -> 3D position, for every texel the sheet's UV triangles cover. */
export function rasterizeUV(geom, W, H) {
  const position = new Float32Array(W * H * 3);
  const mask = new Uint8Array(W * H);
  const { position: P, uv, index } = geom;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const x0 = uv[a * 2] * W, y0 = uv[a * 2 + 1] * H;
    const x1 = uv[b * 2] * W, y1 = uv[b * 2 + 1] * H;
    const x2 = uv[c * 2] * W, y2 = uv[c * 2 + 1] * H;
    const lox = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const hix = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const loy = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const hiy = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (hix < lox || hiy < loy) continue;
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(det) < 1e-12) continue;
    for (let py = loy; py <= hiy; py++) {
      const fy = py + 0.5;
      for (let px = lox; px <= hix; px++) {
        const fx = px + 0.5;
        const wa = ((y1 - y2) * (fx - x2) + (x2 - x1) * (fy - y2)) / det;
        if (wa < -0.004) continue;
        const wb = ((y2 - y0) * (fx - x2) + (x0 - x2) * (fy - y2)) / det;
        if (wb < -0.004) continue;
        const wc = 1 - wa - wb;
        if (wc < -0.004) continue;
        const o = py * W + px;
        position[o * 3] = P[a * 3] * wa + P[b * 3] * wb + P[c * 3] * wc;
        position[o * 3 + 1] = P[a * 3 + 1] * wa + P[b * 3 + 1] * wb + P[c * 3 + 1] * wc;
        position[o * 3 + 2] = P[a * 3 + 2] * wa + P[b * 3 + 2] * wb + P[c * 3 + 2] * wc;
        mask[o] = 1;
      }
    }
  }
  return { position, mask };
}

/**
 * Vertical extent of a body, robust to stray geometry.
 *
 * A raw bounding box is NOT usable here. Measured on pmc_hum_chris, his sheets reach down
 * to y = -0.168 -- below the floor -- while his head tops out at 1.814. The raw box calls
 * him 1.983 tall; al_hum_starter01 measures 1.869 the same way, yet their heads sit at
 * 1.814 and 1.821. The two are the same height and the 6% "difference" was entirely stray
 * geometry. Percentile extents ignore it.
 */
export function bodyBounds(bundle) {
  const ys = [];
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for (const tex of bodySheets(bundle)) {
    const g = bundle.geometryFor(tex.hash);
    if (!g) continue;
    const p = g.position;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < minx) minx = p[i]; if (p[i] > maxx) maxx = p[i];
      if (p[i + 2] < minz) minz = p[i + 2]; if (p[i + 2] > maxz) maxz = p[i + 2];
      ys.push(p[i + 1]);
    }
  }
  if (!ys.length) return { minx: 0, minz: 0, maxx: 0, maxz: 0, miny: 0, maxy: 0, height: 0 };
  ys.sort((a, b) => a - b);
  // Trim 2% off each end. 0.5% was not enough: on a low-poly mesh it rounds to index 0 and
  // picks the very outlier it was meant to discard, and on a real character the geometry
  // reaching below the floor is a whole sheet rather than a few loose vertices.
  const at = (q) => ys[Math.min(ys.length - 1, Math.max(0, Math.floor(ys.length * q)))];
  const miny = at(0.02), maxy = at(0.98);
  return { minx, minz, maxx, maxz, miny, maxy, height: maxy - miny };
}

/**
 * Relate the donor body to the target body.
 *
 * ★ It does NOT rescale, and that is a measured decision rather than an omission.
 *
 * Every character in this game is rigged to the same skeleton and exported in the same
 * bind pose, so the two bodies already occupy the same space. Height-matching them makes
 * the correspondence WORSE, in both directions:
 *
 *     chris  <- allied     median error  0.0098 raw   vs  0.0159 rescaled
 *     allied <- chris      median error  0.0055 raw   vs  0.0133 rescaled
 *
 * An earlier version rescaled by raw-bounding-box height and shipped a 6% error for a pair
 * that actually stands the same height. If a genuine size difference ever turns up, this
 * reports it rather than silently correcting for it.
 */
export function alignment(target, donor) {
  const A = bodyBounds(target);
  const B = bodyBounds(donor);
  const ratio = B.height > 1e-6 ? A.height / B.height : 1;
  return {
    scale: 1,
    inv: 1,
    ca: [0, 0, 0],
    cb: [0, 0, 0],
    /** target-space point -> donor space. Identity: the bind pose already aligns them. */
    toDonor: (x, y, z) => [x, y, z],
    targetHeight: A.height,
    donorHeight: B.height,
    heightRatio: ratio,
    // Same rig, same bind pose -- anything past a few percent means one of them is not a
    // standard human body, and the swap is likely to look wrong.
    heightMismatch: Math.abs(ratio - 1) > 0.08,
  };
}

/** Bleed colour outward past the UV island edges.
 *
 *  Skipping this leaves the texels just outside an island black, and because DXT compresses
 *  in 4x4 blocks that black is pulled back INSIDE the island as a dark fringe on every seam.
 */
export function dilate(rgba, mask, W, H, rounds = 8) {
  const m = Uint8Array.from(mask);
  const D = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let r = 0; r < rounds; r++) {
    const add = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        if (m[o]) continue;
        let cr = 0, cg = 0, cb = 0, n = 0;
        for (const [dy, dx] of D) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          const p = yy * W + xx;
          if (!m[p]) continue;
          cr += rgba[p * 4]; cg += rgba[p * 4 + 1]; cb += rgba[p * 4 + 2]; n++;
        }
        if (n) add.push(o, cr / n, cg / n, cb / n);
      }
    }
    if (!add.length) break;
    for (let i = 0; i < add.length; i += 4) {
      const o = add[i];
      rgba[o * 4] = add[i + 1]; rgba[o * 4 + 1] = add[i + 2];
      rgba[o * 4 + 2] = add[i + 3]; rgba[o * 4 + 3] = 255;
      m[o] = 1;
    }
  }
}

/**
 * Transfer the donor's clothing onto every diffuse sheet of the target.
 *
 * @param {object} o.target       readBundle() result -- whose BODY is used
 * @param {object} o.donor        readBundle() result -- whose CLOTHES are used
 * @param {Map}    o.donorImages  donor texture hash -> ImageData
 * @param {Map}    o.targetSizes  target texture hash -> {width,height}
 * @returns {{results: Map<string,{image: ImageData, stats: object}>, align: object}}
 */
export function transferOutfit({ target, donor, donorImages, targetSizes, onProgress }) {
  const samples = surfaceSamples(donor);
  if (!samples.count) throw new Error('The donor bundle has no diffuse geometry to copy from.');
  const grid = buildGrid(samples.pos, samples.count);
  const align = alignment(target, donor);

  // donor sheet index -> pixel source
  const src = samples.sheets.map((t) => {
    const img = donorImages.get(t.hash);
    return img ? { data: img.data, w: img.width, h: img.height } : null;
  });

  const results = new Map();
  const sheets = bodySheets(target);
  sheets.forEach((tex, n) => {
    if (onProgress) onProgress(n, sheets.length, tex);
    const geom = target.geometryFor(tex.hash);
    if (!geom) return;
    const size = targetSizes.get(tex.hash) || { width: tex.width, height: tex.height };
    const W = size.width, H = size.height;
    if (!W || !H) return;

    const { position, mask } = rasterizeUV(geom, W, H);
    const out = new Uint8ClampedArray(W * H * 4);
    const filled = new Uint8Array(W * H);
    // Preallocated: pushing ~250k entries onto a plain array and sorting it was a
    // measurable share of the runtime, and the upper bound is known.
    const dists = new Float64Array(W * H);
    let nd = 0;
    const probe = { d2: 0 };
    let unmapped = 0;
    const { inv, ca, cb } = align;
    const ca0 = ca[0], ca1 = ca[1], ca2 = ca[2];
    const cb0 = cb[0], cb1 = cb[1], cb2 = cb[2];

    for (let o = 0; o < W * H; o++) {
      if (!mask[o]) continue;
      const dx = (position[o * 3] - ca0) * inv + cb0;
      const dy = (position[o * 3 + 1] - ca1) * inv + cb1;
      const dz = (position[o * 3 + 2] - ca2) * inv + cb2;
      const p = nearest(grid, dx, dy, dz, probe);
      if (p < 0) { unmapped++; continue; }
      const s = src[samples.sheet[p]];
      if (!s) { unmapped++; continue; }
      dists[nd++] = Math.sqrt(probe.d2);
      // bilinear: nearest-texel aliases badly when the donor sheet is denser than the
      // target's, which is the common case for a 1024 donor onto a 512 target
      const u = Math.min(1, Math.max(0, samples.uv[p * 2])) * (s.w - 1);
      const v = Math.min(1, Math.max(0, samples.uv[p * 2 + 1])) * (s.h - 1);
      const x0 = Math.floor(u), y0 = Math.floor(v);
      const x1 = Math.min(x0 + 1, s.w - 1), y1 = Math.min(y0 + 1, s.h - 1);
      const fx = u - x0, fy = v - y0;
      const i00 = (y0 * s.w + x0) * 4, i01 = (y0 * s.w + x1) * 4;
      const i10 = (y1 * s.w + x0) * 4, i11 = (y1 * s.w + x1) * 4;
      for (let c = 0; c < 3; c++) {
        out[o * 4 + c] =
          (s.data[i00 + c] * (1 - fx) + s.data[i01 + c] * fx) * (1 - fy) +
          (s.data[i10 + c] * (1 - fx) + s.data[i11 + c] * fx) * fy;
      }
      out[o * 4 + 3] = 255;
      filled[o] = 1;
    }

    dilate(out, filled, W, H);
    const sorted = dists.subarray(0, nd).slice().sort();
    const pick = (q) => (nd ? sorted[Math.min(nd - 1, Math.floor(nd * q))] : 0);
    results.set(tex.hash, {
      image: mkImage(out, W, H),
      stats: {
        texels: nd,
        unmapped,
        median: pick(0.5),
        p99: pick(0.99),
        // as a fraction of body height -- the only scale-free way to read it
        medianPct: align.targetHeight ? (pick(0.5) / align.targetHeight) * 100 : 0,
        p99Pct: align.targetHeight ? (pick(0.99) / align.targetHeight) * 100 : 0,
      },
    });
  });

  return { results, align, donorSamples: samples.count };
}

/**
 * What to tell someone BEFORE they commit to a pairing.
 *
 * The honest reading of the fit is the p99 correspondence error: it is the parts of the
 * target body the donor has no counterpart for. A backpack, a helmet crest or a holster on
 * the target that the donor lacks shows up here, and those regions get the nearest thing
 * instead -- usually a smear.
 */
export function describeFit(stats, align) {
  const p = stats.p99Pct;
  if (p < 2) return { level: 'ok', text: 'Excellent fit — the donor covers this whole body.' };
  if (p < 5) {
    return { level: 'ok', text: 'Good fit. A few small areas have no close counterpart on the donor.' };
  }
  if (p < 12) {
    return { level: 'warn', text: 'Workable, but parts of this body sit well away from anything on the donor ' +
      '(gear the donor does not have). Those areas take the nearest colour and can smear — check the preview.' };
  }
  return { level: 'bad', text: 'Poor fit. Large parts of this body have no counterpart on the donor, so they ' +
    'will be filled with whatever was nearest. Try a donor with a similar build.' };
}
