// "I just want to wear that guy's uniform."
//
// The whole feature exists because the intuitive version of this does not work. Copying the
// donor's sheet over the target's and renaming it fails: characters do not share UV
// layouts, so the sleeves land on the thighs (see src/transfer.js for the measurements).
// What this does instead is re-map the donor's clothing through 3D into the target's own
// layout, which works for ANY pair rather than only for same-family variants.
//
// The wizard drives the flow and verifies both folders; this only runs the transfer and
// explains the result.

import { el } from './dom.js';
import { transferOutfit, describeFit, bodySheets } from '../transfer.js';

/**
 * @returns {{results: Map, card: HTMLElement}}
 */
export function runSwap({ target, donor, donorImages, targetSizes }) {
  if (!bodySheets(donor).length) {
    throw new Error(`${donor.name} has no diffuse body sheets, so it has no clothing to give.`);
  }
  const t0 = performance.now();
  const { results, align, donorSamples } = transferOutfit({
    target, donor, donorImages, targetSizes,
  });
  const ms = Math.round(performance.now() - t0);
  if (!results.size) throw new Error('Nothing to transfer — the target has no diffuse sheets.');
  return { results, card: report(results, align, donor, target, donorSamples, ms) };
}

function report(results, align, donor, target, donorSamples, ms) {
  const box = el('div');

  box.appendChild(el('div', 'wz-note',
    `Re-mapped ${results.size} sheet${results.size === 1 ? '' : 's'} in ${ms} ms against `
    + `${donorSamples.toLocaleString()} surface points on ${donor.name}. `
    + 'Both characters are rigged to the same skeleton in the same pose '
    + `(${align.targetHeight.toFixed(2)} vs ${align.donorHeight.toFixed(2)} units tall), so `
    + 'their bodies already line up and nothing needed rescaling.'));

  if (align.heightMismatch) {
    box.appendChild(el('div', 'wz-warn',
      `⚠ These two are ${Math.abs((align.heightRatio - 1) * 100).toFixed(0)}% different in `
      + 'height, which is unusual for characters on a shared rig. One of them may not be a '
      + 'standard human body — check the result carefully.'));
  }

  // Per-sheet fit. The p99 correspondence error is the honest reading: it is the parts of
  // the target body the donor has no counterpart for.
  const tbl = el('div', 'swap-rows');
  for (const tex of bodySheets(target)) {
    const r = results.get(tex.hash);
    if (!r) continue;
    const fit = describeFit(r.stats, align);
    const row = el('div', 'swap-row ' + fit.level);
    row.appendChild(el('span', 'thash', tex.name || tex.hash));
    row.appendChild(el('span', 'tdim', `${r.image.width}×${r.image.height}`));
    row.appendChild(el('span', 'tdim',
      `fit ${r.stats.medianPct.toFixed(2)}% median · ${r.stats.p99Pct.toFixed(1)}% worst`));
    row.appendChild(el('span', 'swap-fit', fit.text));
    tbl.appendChild(row);
  }
  box.appendChild(tbl);

  const worst = [...results.values()].reduce((a, b) => (a.stats.p99Pct > b.stats.p99Pct ? a : b));
  if (describeFit(worst.stats, align).level !== 'ok') {
    box.appendChild(el('div', 'wz-note',
      'A poor fit almost always means the two characters carry different gear — a backpack, '
      + 'webbing or a helmet on one that the other does not have. The body underneath still '
      + 'transfers correctly; it is the extra hardware that has nowhere to come from.'));
  }

  box.appendChild(el('div', 'wz-note',
    'These sheets are loaded as your edits — look through them below, touch anything up, '
    + 'then export.'));
  return box;
}
