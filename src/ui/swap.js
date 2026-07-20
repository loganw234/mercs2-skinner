// "I just want to wear that guy's uniform."
//
// The whole panel exists because the intuitive version of this does not work. Copying the
// donor's sheet over the target's and renaming it fails: characters do not share UV
// layouts, so the sleeves land on the thighs (see src/transfer.js for the measurements).
// What this does instead is re-map the donor's clothing through 3D into the target's own
// layout, which works for ANY pair rather than only for same-family variants.
//
// The user-facing consequence is that this needs TWO export bundles, not one, and saying
// so up front is most of the job.

import { $, el, wireDrop } from './dom.js';
import { transferOutfit, describeFit, bodySheets } from '../transfer.js';

let CTX = null;

/**
 * @param {object} o.parseFolder  (files) -> {bundle, images}   -- shared with the main load
 * @param {object} o.getTarget    () -> the currently loaded bundle (whose BODY is used)
 * @param {object} o.getSizes     () -> Map hash -> {width,height} for the target
 * @param {Function} o.onApply    (Map hash -> ImageData) once the swap is computed
 * @param {Function} o.status
 */
export function initSwap(o) {
  CTX = o;
  wireDrop($('#swap-drop'), $('#swap-input'), (files) => run(files).catch(o.fail));
}

/** Show or hide the whole step, and tailor its copy to the character already chosen. */
export function setSwapVisible(on, targetName) {
  const sec = $('#step-swap');
  if (!sec) return;
  sec.hidden = !on;
  if (on) {
    $('#swap-intro').textContent = targetName
      ? `You are wearing ${targetName}'s body. Now drop the character whose CLOTHES you want — `
        + 'a second export bundle, exported exactly the same way.'
      : 'Drop the character whose CLOTHES you want — a second export bundle.';
  }
}

async function run(files) {
  const target = CTX.getTarget();
  if (!target) throw new Error('Load the character wearing the outfit first (step 1).');

  CTX.status('reading the donor bundle…');
  const { bundle: donor, images: donorImages } = await CTX.parseFolder(files);
  if (donor.name === target.name) {
    throw new Error(`That is the same character (${donor.name}). The donor has to be a `
      + 'different character — the one whose clothes you want.');
  }
  if (!bodySheets(donor).length) {
    throw new Error(`${donor.name} has no diffuse body sheets of its own, so it has no `
      + 'clothing to give. Pick a character that owns its textures.');
  }

  $('#swap-name').textContent = `${donor.name} → ${target.name}`;
  CTX.status(`re-mapping ${donor.name}'s clothing onto ${target.name}…`);

  // Yield first so the status paints -- the transfer is a few hundred thousand nearest
  // point queries and will block the frame.
  await new Promise((r) => setTimeout(r, 16));

  const t0 = performance.now();
  const { results, align, donorSamples } = transferOutfit({
    target,
    donor,
    donorImages,
    targetSizes: CTX.getSizes(),
  });
  const ms = Math.round(performance.now() - t0);

  if (!results.size) throw new Error('Nothing to transfer — the target has no diffuse sheets.');
  CTX.onApply(results);
  report(results, align, donor, target, donorSamples, ms);
  CTX.status('');
}

function report(results, align, donor, target, donorSamples, ms) {
  const box = $('#swap-report');
  box.innerHTML = '';
  box.hidden = false;

  box.appendChild(el('div', 'wz-note',
    `Re-mapped ${results.size} sheet${results.size === 1 ? '' : 's'} in ${ms} ms against `
    + `${donorSamples.toLocaleString()} surface points on ${donor.name}. `
    + `Both characters are rigged to the same skeleton in the same pose `
    + `(${align.targetHeight.toFixed(2)} vs ${align.donorHeight.toFixed(2)} units tall), so `
    + 'their bodies already line up and nothing needed rescaling.'));

  if (align.heightMismatch) {
    box.appendChild(el('div', 'wz-warn',
      `⚠ These two are ${Math.abs((align.heightRatio - 1) * 100).toFixed(0)}% different in `
      + 'height, which is unusual for characters on a shared rig. One of them may not be a '
      + 'standard human body — check the result carefully.'));
  }

  // Per-sheet fit. The p99 correspondence error is the honest reading: it is the parts of
  // the target body that the donor simply has no counterpart for.
  const tbl = el('div', 'swap-rows');
  const sheets = bodySheets(target);
  for (const tex of sheets) {
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
      + 'transfers correctly; it is the extra hardware that has nowhere to come from. Check '
      + 'the 3D preview before exporting.'));
  }

  box.appendChild(el('div', 'wz-note',
    'These sheets are now loaded as your edits — look through them in step 2, touch anything '
    + 'up (the recolour still works), then export from step 3 exactly as normal.'));
}
