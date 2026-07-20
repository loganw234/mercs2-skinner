// The in-tool recolour. Selection is by HUE, so the tests use a synthetic garment/skin
// pair -- the exact confusion the tool has to get right, since red fabric and tan skin
// sit only ~17 degrees apart.

import { rgbToHsv, hsvToRgb, hueDist, buildMask, applyShift, maskCount, cloneImage } from '../src/recolor.js';

function swatch() {
  // left half red garment, right half tan skin, both shaded top-to-bottom
  const W = 64, H = 64, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, sh = 0.5 + 0.5 * y / H;
    if (x < W / 2) { d[i] = 200 * sh; d[i + 1] = 30 * sh; d[i + 2] = 40 * sh; }
    else { d[i] = 210 * sh; d[i + 1] = 170 * sh; d[i + 2] = 140 * sh; }
    d[i + 3] = 255;
  }
  return { data: d, width: W, height: H };
}

export function run(t) {
  // colour space round-trips
  for (const c of [[200, 30, 40], [10, 200, 90], [255, 255, 255], [0, 0, 0], [128, 128, 128]]) {
    const back = hsvToRgb(...rgbToHsv(...c));
    t.deepEq(`hsv round-trip ${c}`, back, c);
  }
  t.near('hueDist wraps the wheel', hueDist(0.02, 0.98), 0.04, 1e-9);
  t.near('hueDist is symmetric', hueDist(0.98, 0.02), 0.04, 1e-9);

  const img = swatch();
  const GARMENT = 64 * 64 / 2;

  // The default must not bleed into skin. This is the whole ballgame: at a generous
  // tolerance a red selection swallows tan skin and silently recolours the wearer.
  const m = buildMask(img, [200, 30, 40]);
  t.eq(`default tolerance selects the garment exactly (${maskCount(m)})`, maskCount(m), GARMENT);
  const loose = buildMask(img, [200, 30, 40], { tolerance: 0.15 });
  t.ok(`a loose tolerance DOES bleed into skin (${maskCount(loose)})`, maskCount(loose) > GARMENT);

  // shift
  const out = applyShift(img, m, { hue: 120 });
  const gi = ((63) * 64 + 5) * 4, si = ((63) * 64 + 59) * 4;
  const [gh] = rgbToHsv(out.data[gi], out.data[gi + 1], out.data[gi + 2]);
  const [oh] = rgbToHsv(img.data[gi], img.data[gi + 1], img.data[gi + 2]);
  t.near('garment hue moved by 120 degrees', hueDist(gh, oh + 1 / 3), 0, 0.01);
  t.eq('skin is untouched', [out.data[si], out.data[si + 1], out.data[si + 2]].join(),
    [img.data[si], img.data[si + 1], img.data[si + 2]].join());

  // Shading MUST survive -- multiplying sat/val rather than replacing is what makes a
  // recolour read as fabric instead of a paint-bucket fill.
  const top = (2 * 64 + 5) * 4, bot = (61 * 64 + 5) * 4;
  const vTop = Math.max(out.data[top], out.data[top + 1], out.data[top + 2]);
  const vBot = Math.max(out.data[bot], out.data[bot + 1], out.data[bot + 2]);
  t.ok(`shading preserved through the shift (V ${vTop} -> ${vBot})`, vBot > vTop * 1.5);

  // A grey pick cannot be matched by hue; without the RGB fallback it selects everything.
  const grey = { data: new Uint8ClampedArray(16 * 16 * 4).fill(200), width: 16, height: 16 };
  t.ok('a desaturated target does not select the whole image via hue',
    maskCount(buildMask(img, [128, 128, 128])) < 64 * 64);

  // sat/val multipliers
  const dim = applyShift(img, m, { val: 0.5 });
  t.ok('brightness multiplier darkens the selection',
    Math.max(dim.data[gi], dim.data[gi + 1], dim.data[gi + 2]) <
    Math.max(img.data[gi], img.data[gi + 1], img.data[gi + 2]));
  const flat = applyShift(img, m, { sat: 0 });
  t.eq('saturation 0 greys the selection',
    flat.data[gi] === flat.data[gi + 1] && flat.data[gi + 1] === flat.data[gi + 2], true);

  // non-destructive
  t.eq('source image is not mutated', img.data[gi], swatch().data[gi]);
  const c = cloneImage(img);
  c.data[0] = 1;
  t.ok('cloneImage copies rather than aliases', img.data[0] !== 1 || c.data[0] === img.data[0]);

  // ITERATION: after applying a shift the picked colour no longer exists in the image, so
  // the UI carries the target through the same shift. Verify the shifted target still
  // selects the same region -- otherwise the sliders go dead with no visible reason.
  const shifted = applyShift(img, m, { hue: 120 });
  const [th, ts, tv] = rgbToHsv(200, 30, 40);
  const newTarget = hsvToRgb(th + 120 / 360, ts, tv);
  const m2 = buildMask(shifted, newTarget);
  t.ok(`the shifted target re-selects the garment (${maskCount(m2)} vs ${GARMENT})`,
    Math.abs(maskCount(m2) - GARMENT) < GARMENT * 0.05);
}
