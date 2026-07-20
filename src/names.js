// Hash -> asset name recovery.
//
// The WAD stores only hashes, so an export bundle hands you `tex_0x8DE46BB7.png` and
// nothing else. Hashing the recovered name list back turns that into
// `civ_hum_beachfemale_a_head`, which matters twice over:
//   * the UI becomes readable -- "upper body" instead of a hex blob
//   * the modkit's texture-swap contract targets a texture BY NAME, so without this the
//     modkit export path is impossible
//
// Names arrive front-coded (see tools/bake_names.py). Decoding + hashing 10k names takes
// a few ms, so it is done once, lazily, on first lookup.

import { pandemicHashM2 } from './export.js';

let TABLE = null;
let SOURCE = null;

/** Provide the front-coded blob (bundled build sets this; dev build fetches it). */
export function setNameSource(blob) {
  SOURCE = blob;
  TABLE = null;
}

export function decodeNames(blob) {
  const out = [];
  let prev = '';
  // Split on either line ending: the blob is written on Windows, and a stray \r would
  // silently become part of every name, so every hash lookup would miss.
  for (const line of blob.split(/\r?\n/)) {
    if (!line) continue;
    const shared = line.charCodeAt(0) - 48;
    const name = prev.slice(0, shared) + line.slice(1);
    out.push(name);
    prev = name;
  }
  return out;
}

function build() {
  TABLE = new Map();
  if (!SOURCE) return TABLE;
  for (const n of decodeNames(SOURCE)) {
    const h = pandemicHashM2(n);
    // First name wins: the list is sorted, so a collision keeps the shorter/earlier form
    // rather than whichever happened to be read last.
    if (!TABLE.has(h)) TABLE.set(h, n);
  }
  return TABLE;
}

/** @param {string|number} hash  '0x8DE46BB7' or 0x8DE46BB7 */
export function nameForHash(hash) {
  if (!TABLE) build();
  const h = typeof hash === 'string' ? parseInt(hash.replace(/^0x/i, ''), 16) >>> 0 : hash >>> 0;
  return TABLE.get(h) || null;
}

export const nameCount = () => (TABLE || build()).size;

/** Split a recovered texture name into something a person can scan.
 *  `civ_hum_beachfemale_a_ub_nm` -> {part: 'upper body', map: 'normal'} */
const PART = {
  head: 'head', ub: 'upper body', lb: 'lower body', hair: 'hair',
  body: 'body', face: 'face', arm: 'arm', leg: 'leg', hand: 'hand',
};
const MAP = { nm: 'normal', sm: 'specular', spec: 'specular', d: 'diffuse' };

export function describeName(name) {
  if (!name) return null;
  const toks = name.split('_');
  let map = null;
  if (MAP[toks[toks.length - 1]]) map = MAP[toks.pop()];
  let part = null;
  for (let i = toks.length - 1; i >= 0 && !part; i--) part = PART[toks[i]] || null;
  return { part, map, base: toks.join('_') };
}
