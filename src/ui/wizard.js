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
    ['swap', 'Wear someone else\'s outfit', 'Put another character\'s clothing onto this one. No painting at all — the tool does the work.'],
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
    // Both "add outfits" and "wear someone else's" put the result on a character's own
    // model, so both need a character that HAS one.
    const list = g === 'replace' ? chars : chars.filter((c) => c.kind === 'clone');

    rest.innerHTML = '';
    rest.appendChild(el('div', 'wz-q',
      g === 'swap' ? 'Whose BODY are you dressing?' : 'Which character?'));

    if (g === 'swap') {
      rest.appendChild(el('div', 'wz-note',
        'Pick the character you want to BE — their body, face and build. You will pick whose '
        + 'clothes they wear in a moment. The two do not need matching texture layouts: the '
        + 'tool re-maps the clothing through the 3D body, so any pair works.'));
    }

    if (g === 'variants') {
      const safe = list.filter((c) => c.blocks === 1).length;
      rest.appendChild(el('div', 'wz-note',
        `${list.length} characters have a model of their own and can host new outfits. `
        + `${safe} of them are single-block, meaning a clone keeps full detail at every `
        + 'distance — those are listed first and marked ✓. The rest are two-block: cloning '
        + 'one works, but it loses its finer geometry and the face visibly flattens. The '
        + 'remainder of the roster is stored as shared sub-entries and can be reskinned in '
        + 'place but never duplicated.'));
    }

    // Whether a ready-made template exists is the single most useful thing to know before
    // choosing, since it decides whether you can start painting now or have to install the
    // toolchain first. Marking it in the option label saves selecting each one to find out.
    const withTpl = list.filter((c) => c.template && c.template.length).length;
    if (withTpl) {
      rest.appendChild(el('div', 'wz-note',
        `${withTpl} of these ${list.length} have ready-made templates, marked ✓ — pick one `
        + 'of those and you can start painting immediately, with no game tools at all.'));
    }

    const sel = el('select');
    sel.id = 'wz-char';
    const byFaction = {};
    for (const c of list) (byFaction[c.faction] = byFaction[c.faction] || []).push(c);
    sel.appendChild(el('option', null, '— choose —'));
    for (const f of Object.keys(byFaction).sort()) {
      const og = document.createElement('optgroup');
      og.label = f;
      // Clone-safe first (only meaningful under "add outfits"), then template-ready, so
      // the options that will actually work well are not buried under ones that will not.
      const sorted = [...byFaction[f]].sort((a, b) =>
        (a.blocks === 1 ? 0 : 1) - (b.blocks === 1 ? 0 : 1)
        || (b.template ? 1 : 0) - (a.template ? 1 : 0)
        || a.name.localeCompare(b.name));
      for (const c of sorted) {
        const n = (c.template || []).length;
        const bits = [];
        if (c.blocks === 1) bits.push('✓ full detail');
        else if (c.blocks === 2) bits.push('⚠ loses detail if cloned');
        if (n) bits.push(`${n} template${n === 1 ? '' : 's'}`);
        const parts = c.sheets.length ? c.sheets.map((s) => s.part).join(', ') : 'no own sheets';
        const o = el('option', null, `${c.name}   (${parts})   ${bits.join(' · ')}`);
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

  // Clone-safety matters for the swap too: a swapped outfit shipped as a NEW asset clones
  // the body's model, so a two-block body flattens exactly as it would for a variant.
  if (goal === 'variants' || goal === 'swap') {
    if (c.blocks === 1) {
      root.appendChild(el('div', 'wz-ok',
        '✓ Clone-safe. This character keeps all its geometry in one place, so a copy of it '
        + 'looks exactly as sharp as the original.'));
    } else if (c.blocks === 2) {
      root.appendChild(el('div', 'wz-warn',
        '⚠ Cloning this one costs detail. Its finer geometry lives in a second block that a '
        + 'clone cannot carry, so your version renders its coarsest tier at every distance — '
        + 'the face visibly flattens. It still works, and reskinning it in place instead '
        + 'avoids the problem entirely.'));
    }
    if (!c.ownSheets) {
      root.appendChild(el('div', 'wz-note',
        'This character has no body textures of its own — it borrows another character\'s. '
        + 'You can still clone it, but the textures you repoint belong to someone else, so '
        + 'check the preview carefully.'));
    }
  }

  // --- the no-setup path ---
  // Painting a sheet needs a template far more urgently than it needs the game's artwork,
  // and templates carry no artwork so they can just be handed over. Someone can start
  // designing right now and only install the toolchain when they have something to inject.
  if (c.template && c.template.length) {
    const n = c.template.length;
    root.appendChild(el('div', 'wz-q', 'Start painting now — no install needed'));
    root.appendChild(el('div', 'wz-note',
      `${n} ready-made template${n === 1 ? '' : 's'} for this character: every UV island `
      + 'filled flat and coloured by the body part that drives it, so you can see what you '
      + 'are painting. Open one in any image editor and go. You only need the game tools '
      + 'later, to put the result back in.'));
    // The catalogue lists sheets a character OWNS by name; templates cover the sheets its
    // model actually PAINTS at the finest detail level. Those differ on low-detail NPCs
    // that borrow a shared body sheet, and the gap is confusing unless it is named.
    const painted = new Set(c.template.map((f) => f.replace('_SAFE.png', '')));
    const missing = c.sheets.filter((s) => !painted.has(s.name)).map((s) => s.part);
    if (missing.length) {
      root.appendChild(el('div', 'wz-note',
        `No template for its ${missing.join(', ')} sheet${missing.length === 1 ? '' : 's'} — `
        + 'this model does not paint them at its finest detail level, usually because it '
        + 'borrows a shared body texture. Export it below to work on those.'));
    }
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
    pre.textContent = goal === 'swap'
      // The swap needs TWO bundles, and finding that out one command at a time is the most
      // annoying possible way to learn it. Emit both, with the second left to fill in.
      ? `mercs2_workshop --export-bundle ${c.name} --out "${dir}"\n`
        + `mercs2_workshop --export-bundle <the_character_whose_clothes_you_want> --out "${dir}"`
      : `mercs2_workshop --export-bundle ${c.name} --out "${dir}"`;
  };
  out.addEventListener('input', upd);
  upd();

  root.appendChild(el('div', 'wz-note', goal === 'swap'
    ? `Run it twice — once for ${c.name} and once for whoever owns the outfit. Each writes its `
      + 'own folder containing manifest.json, model.gltf, model.bin, textures and raw. Drop '
      + `${c.name}'s folder in step 1, then the other one in step 1b.`
    : `That writes ${'"'}${'{'}folder${'}'}\\${c.name}\\${'"'} containing manifest.json, model.gltf, model.bin, `
      + 'a textures folder and a raw folder. Drag that whole character folder onto the drop '
      + 'zone below — not the individual files.'));

  if (goal === 'swap') {
    root.appendChild(el('div', 'wz-note',
      'Any character with its own textures can be the donor, including ones that cannot be '
      + 'cloned — you are only borrowing their artwork, not their model. So the whole roster '
      + 'is available as a wardrobe.'));
  }

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
      'You cloned a two-block character. 38 of the 85 characters with a model are '
      + 'single-block and keep full detail when cloned — those are the ones marked ✓. '
      + 'See docs/LOD-CHAIN.md.'],
    ['The swapped outfit looks smeared in places',
      'The donor has no counterpart for part of that body — usually gear one character '
      + 'carries and the other does not, like a backpack or webbing. Those areas take the '
      + 'nearest colour available. The fit percentages in step 1b tell you which sheets are '
      + 'affected; a donor with a similar build fixes it.'],
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
