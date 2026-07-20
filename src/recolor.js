// In-tool recolour: pick a colour, shift everything like it.
//
// This is the "I just want the jacket in red" path. It exists because forcing a round trip
// through an image editor for a hue swap is absurd overhead for the most common edit
// anyone will make.
//
// Selection is by HUE PROXIMITY rather than RGB distance. A garment in shadow and the same
// garment in light are far apart in RGB but nearly identical in hue, so an RGB threshold
// either misses the shaded folds or swallows the skin next to it. Hue distance selects the
// whole garment across its full range of lighting, which is exactly what a recolour wants.

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, mx ? d / mx : 0, mx];
}

export function hsvToRgb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Shortest distance between two hues on the 0..1 wheel. */
export const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
};

/**
 * Which pixels count as "the thing you clicked".
 * @param {ImageData} img
 * @param {[number,number,number]} target  picked RGB
 * @param {{tolerance:number, minSat:number}} o
 *        tolerance 0..1 as a fraction of the hue wheel (0.055 ~ 20 degrees); minSat guards
 *        against grey pixels, whose hue is meaningless and which would otherwise all match
 *        at once.
 *
 *        The default is deliberately tight. Red fabric and tan skin sit only ~17 degrees
 *        apart, so a generous tolerance quietly recolours the wearer along with the
 *        garment -- which is why the UI shows the live selection rather than trusting a
 *        number.
 * @returns {Uint8Array} 1 per selected pixel
 */
export function buildMask(img, target, { tolerance = 0.055, minSat = 0.15 } = {}) {
  const [th, ts] = rgbToHsv(target[0], target[1], target[2]);
  const n = img.width * img.height;
  const mask = new Uint8Array(n);
  const d = img.data;
  // A greyish target cannot be matched by hue at all, so fall back to RGB proximity --
  // otherwise picking a white shirt selects the entire image.
  const greyTarget = ts < minSat;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    if (greyTarget) {
      const dr = r - target[0], dg = g - target[1], db = b - target[2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance * 441) mask[i] = 1;
      continue;
    }
    const [h, s] = rgbToHsv(r, g, b);
    if (s >= minSat && hueDist(h, th) <= tolerance) mask[i] = 1;
  }
  return mask;
}

/**
 * Apply a shift to the masked pixels.
 * Saturation and value are MULTIPLIED, not replaced, so shading survives -- the whole
 * reason a recolour looks like fabric rather than a paint bucket.
 * @param {ImageData} src
 * @param {Uint8Array} mask
 * @param {{hue:number, sat:number, val:number}} o  hue in degrees, sat/val as multipliers
 * @returns {ImageData}
 */
export function applyShift(src, mask, { hue = 0, sat = 1, val = 1 } = {}) {
  const out = cloneImage(src);
  const d = out.data;
  const dh = hue / 360;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const [h, s, v] = rgbToHsv(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const [r, g, b] = hsvToRgb(h + dh, Math.min(1, s * sat), Math.min(1, v * val));
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
  }
  return out;
}

/** Tint the unselected pixels down so the selection is obvious while adjusting. */
export function previewMask(src, mask) {
  const out = cloneImage(src);
  const d = out.data;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    d[i * 4] = d[i * 4] * 0.25 + 10;
    d[i * 4 + 1] = d[i * 4 + 1] * 0.25 + 12;
    d[i * 4 + 2] = d[i * 4 + 2] * 0.25 + 20;
  }
  return out;
}

/** Copy an image, as an ImageData in a browser and a plain object in node -- the module
 *  stays unit-testable without a DOM. */
export function cloneImage(src) {
  const data = new Uint8ClampedArray(src.data);
  return typeof ImageData === 'function'
    ? new ImageData(data, src.width, src.height)
    : { data, width: src.width, height: src.height };
}

export const maskCount = (mask) => {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
};
