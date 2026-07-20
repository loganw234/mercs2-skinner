// Step 0 -- "I have no idea where to start".
//
// The hardest part of this pipeline was never the painting, it was knowing that characters
// exist under names like `vz_hum_solano`, that some clone cleanly and some come out with a
// flattened face, and what to type to get one out of the game. All of that is knowable in
// advance, so this asks two questions and then writes the command out.

import { $, el } from './dom.js';

let CAT = null;
let onPick = () => {};

export function setCatalogue(c) { CAT = c; }
export function onDonorPicked(fn) { onPick = fn; }

/** Everything selectable, clone donors first because they are the ones that can host
 *  variants without consuming anybody's identity. */
export function allCharacters() {
  if (!CAT) return [];
  return [
    ...CAT.donors.map((d) => ({ ...d, kind: 'clone' })),
    ...CAT.reskin.map((d) => ({ ...d, kind: 'reskin', blocks: null })),
  ];
}

export function buildWizard(root) {
  const chars = allCharacters();
  root.innerHTML = '';

  // --- goal ---
  root.appendChild(el('div', 'wz-q', 'What do you want to do?'));
  const goal = el('div', 'wz-opts');
  for (const [id, title, sub] of [
    ['variants', 'Add new outfits', 'Several skins that coexist with the original. Nothing in the game changes unless you wear one.'],
    ['replace', 'Change how someone looks', "Replace a character's own textures. Everyone wearing them changes."],
  ]) {
    const b = el('button', 'wz-opt');
    b.dataset.goal = id;
    b.appendChild(el('div', 'wz-opt-t', title));
    b.appendChild(el('div', 'wz-opt-s', sub));
    b.addEventListener('click', () => { root.dataset.goal = id; render(); });
    goal.appendChild(b);
  }
  root.appendChild(goal);

  const rest = el('div');
  rest.id = 'wz-rest';
  root.appendChild(rest);

  function render() {
    const g = root.dataset.goal;
    for (const b of goal.querySelectorAll('.wz-opt')) b.classList.toggle('sel', b.dataset.goal === g);
    if (!g) { rest.innerHTML = ''; return; }
    const list = g === 'variants' ? chars.filter((c) => c.kind === 'clone') : chars;

    rest.innerHTML = '';
    rest.appendChild(el('div', 'wz-q', 'Which character?'));

    if (g === 'variants') {
      rest.appendChild(el('div', 'wz-note',
        'Only these nine can host new outfits. A character needs its own model entry to be '
        + 'clonable, and most of the roster is stored as a shared sub-entry instead — those '
        + 'can still be reskinned, just not duplicated. Every one listed here is also '
        + 'single-block, meaning a clone keeps its full detail at distance.'));
    }

    const sel = el('select');
    sel.id = 'wz-char';
    const byFaction = {};
    for (const c of list) (byFaction[c.faction] = byFaction[c.faction] || []).push(c);
    sel.appendChild(el('option', null, '— choose —'));
    for (const f of Object.keys(byFaction).sort()) {
      const og = document.createElement('optgroup');
      og.label = f;
      for (const c of byFaction[f]) {
        const o = el('option', null, c.name + (c.sheets.length ? `   (${c.sheets.map((s) => s.part).join(', ')})` : ''));
        o.value = c.name;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    rest.appendChild(sel);

    const detail = el('div');
    detail.id = 'wz-detail';
    rest.appendChild(detail);
    sel.addEventListener('change', () => {
      const c = list.find((x) => x.name === sel.value);
      renderDetail(detail, c, g);
      if (c) onPick(c, g);
    });
  }

  render();
}

function renderDetail(root, c, goal) {
  root.innerHTML = '';
  if (!c) return;

  const sheets = c.sheets.map((s) => `${s.part}${s.size ? ' ' + s.size : ''}`).join(' · ');
  root.appendChild(el('div', 'wz-sheets', `Sheets: ${sheets}`));

  if (goal === 'variants') {
    root.appendChild(el('div', 'wz-ok',
      'Clone-safe. This character keeps all its geometry in one place, so a copy of it looks '
      + 'exactly as sharp as the original.'));
  }

  // --- the no-setup path ---
  // Painting a sheet needs a template far more urgently than it needs the game's artwork,
  // and templates carry no artwork so they can just be handed over. Someone can start
  // designing right now and only install the toolchain when they have something to inject.
  if (c.template && c.template.length) {
    root.appendChild(el('div', 'wz-q', 'Start painting now — no install needed'));
    root.appendChild(el('div', 'wz-note',
      `${c.template.length} ready-made templates for this character: every UV island filled `
      + 'flat and coloured by the body part that drives it, so you can see what you are '
      + 'painting. Open one in any image editor and go. You only need the game tools later, '
      + 'to put the result back in.'));
    const grid = el('div', 'wz-tpl');
    for (const f of c.template) {
      const a = el('a', 'wz-tpl-a', f.replace(c.name + '_', '').replace('_SAFE.png', ''));
      a.href = `templates/${c.name}/${f}`;
      a.target = '_blank';
      a.rel = 'noopener';
      grid.appendChild(a);
    }
    root.appendChild(grid);
    const leg = el('a', 'wz-note', 'colour legend →');
    leg.href = `templates/${c.name}/_LEGEND.png`;
    leg.target = '_blank';
    leg.rel = 'noopener';
    leg.style.display = 'inline-block';
    root.appendChild(leg);
  } else {
    root.appendChild(el('div', 'wz-note',
      'No ready-made template for this character yet — export it below and the tool will '
      + 'draw the UV layout over its real textures, which works just as well.'));
  }

  // --- the command ---
  root.appendChild(el('div', 'wz-q', 'Get the character out of the game'));
  root.appendChild(el('div', 'wz-note',
    'You need mercs2_workshop from the community toolchain (link below). Run it with no '
    + 'arguments first — it opens a browser where you can look at every character in 3D and '
    + 'read its name, which is by far the easiest way to find the one you actually want. '
    + 'The names in the dropdown above are the same ones it shows.'));

  const outWrap = el('label', 'wz-field');
  outWrap.appendChild(el('span', null, 'Where should the files go?'));
  const out = el('input');
  out.type = 'text';
  out.id = 'wz-out';
  out.value = 'C:\\mercs2-skins';
  out.spellcheck = false;
  outWrap.appendChild(out);
  root.appendChild(outWrap);

  const pre = el('pre');
  pre.id = 'wz-cmd';
  root.appendChild(pre);

  const copy = el('button', 'btn ghost', 'Copy command');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(pre.textContent).then(
      () => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy command'), 1400); },
      () => { copy.textContent = 'Copy failed — select it manually'; });
  });
  root.appendChild(copy);

  const upd = () => {
    const dir = (out.value || 'C:\\mercs2-skins').replace(/[\\/]+$/, '');
    pre.textContent = `mercs2_workshop --export-bundle ${c.name} --out "${dir}"`;
  };
  out.addEventListener('input', upd);
  upd();

  root.appendChild(el('div', 'wz-note',
    `That writes ${'"'}${'{'}folder${'}'}\\${c.name}\\${'"'} containing manifest.json, model.gltf, model.bin, `
    + 'a textures folder and a raw folder. Drag that whole character folder onto the drop '
    + 'zone below — not the individual files.'));

  // --- troubleshooting ---
  const tro = el('details', 'wz-tro');
  tro.appendChild(el('summary', null, "It didn't work — what usually goes wrong"));
  const ul = el('ul');
  for (const [q, a] of [
    ['"no model ASET for 0x…"',
      'That character has no model entry of its own, so it cannot be exported or cloned. '
      + 'pmc_hum_jennifer is the well-known example. Pick another, or reskin it in place '
      + 'instead of cloning.'],
    ['The command does nothing / "not recognised"',
      'You are not in the folder holding mercs2_workshop.exe. Either cd into it first, or '
      + 'type the full path to the exe.'],
    ['It cannot find vz.wad',
      'Run it from your Mercenaries 2 install, or pass the game path. It reads the base WAD '
      + 'from the install — it never modifies it.'],
    ['I dropped the folder and the tool says it is not a bundle',
      'Drop the folder named after the character, the one containing manifest.json. Dropping '
      + 'its parent, or the textures folder on its own, will not work.'],
    ['The export has no textures folder',
      'The character has no textures of its own — it borrows another character\'s. Nothing '
      + 'to reskin there; pick a different one.'],
    ['My skin loaded but the face looks flattened',
      'You cloned a two-block character. Only the nine listed under "Add new outfits" keep '
      + 'their detail when cloned. See docs/LOD-CHAIN.md.'],
    ['The game crashed to desktop when I wore it',
      'The name did not resolve — the asset is not actually in your patch. Check the patch '
      + 'merged correctly. There is no soft failure for a missing model.'],
  ]) {
    const li = el('li');
    li.appendChild(el('b', null, q));
    li.appendChild(el('div', null, a));
    ul.appendChild(li);
  }
  tro.appendChild(ul);
  root.appendChild(tro);
}
