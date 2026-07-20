// Step 0 -- "I have no idea where to start".
//
// This used to be one long panel holding every question, every caveat and both commands at
// once. All of it was correct and all of it was on screen, which is precisely why it did
// not work: a beginner cannot tell which sentence applies to them right now, so they read
// none of them and ask instead. Density is the bug.
//
// So it is a rail now (see rail.js): one question open, finished ones collapsed to a tick,
// later ones visibly locked. Choices are cards with a little figure showing what the choice
// actually does, because "whose BODY" versus "whose clothes" is read from a picture by
// people who will not read the sentence. And every point where the user has to go and do
// something outside the tool ends with the tool CHECKING their work rather than wishing
// them luck.

import { $, el, wireDrop } from './dom.js';
import { Rail, verdict } from './rail.js';
import { ART, person } from './figure.js';

let CAT = null;
let onPick = () => {};
let onNeedBundle = null;
let rail = null;

export function setCatalogue(c) { CAT = c; }
export function onDonorPicked(fn) { onPick = fn; }
/** app.js supplies the folder reader so the wizard can verify a drop before advancing. */
export function setBundleLoader(fn) { onNeedBundle = fn; }

/**
 * Everything the tool can actually load.
 *
 * ★ ONLY characters with a model ASET row. The catalogue also carries `textureOnly` --
 * names recovered from TEXTURE names that have no model of their own -- and none of those
 * can be exported, so none can enter this tool by any route:
 *
 *     [FAIL] ch_hum_officer (0xD2A9DF48): no model ASET for 0xD2A9DF48
 *
 * An earlier build offered all 67 of them as outfit donors. Every one was a dead end, and
 * the failure only shows up at the command line, long after the choice was made. If a
 * picker ever needs widening, widen it here and nowhere else.
 */
export function allCharacters() {
  if (!CAT) return [];
  return CAT.donors.map((d) => ({ ...d, kind: 'clone' }));
}

const GOALS = {
  variants: {
    title: 'Add new outfits',
    sub: 'Extra skins that sit alongside the original. Nothing in the game changes until you choose to wear one.',
    bodyQ: 'Which character?',
  },
  replace: {
    title: 'Change how someone looks',
    sub: "Repaint a character's own textures. Everyone who wears them changes.",
    bodyQ: 'Which character?',
  },
  swap: {
    title: "Wear someone else's outfit",
    sub: 'Put one character\'s clothing onto another. No painting at all — the tool does the work.',
    bodyQ: 'Whose body are you dressing?',
  },
};

const W = { goal: null, body: null, donor: null, outDir: 'C:\\mercs2-skins' };

export function buildWizard(root) {
  rail = new Rail(root);
  W.goal = W.body = W.donor = null;
  // The rail ending is the one moment the user could be left wondering where to look, so
  // take them to the panel that just appeared instead of hoping they scroll.
  rail.onFinish = () => {
    const t = document.getElementById('step-edit');
    if (t && !t.hidden) setTimeout(() => t.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };

  rail.add('goal', 'What do you want to do?', stepGoal,
    () => (W.goal ? GOALS[W.goal].title : ''));
  rail.draw();
  return rail;
}

// ---------------------------------------------------------------- 1. goal
function stepGoal(body) {
  const cards = el('div', 'cards');
  for (const id of ['variants', 'replace', 'swap']) {
    const g = GOALS[id];
    const b = el('button', 'card' + (W.goal === id ? ' sel' : ''));
    b.type = 'button';
    const art = el('div', 'card-art');
    art.innerHTML = ART[id]();
    b.appendChild(art);
    b.appendChild(el('div', 'card-t', g.title));
    b.appendChild(el('div', 'card-s', g.sub));
    b.addEventListener('click', () => {
      W.goal = id;
      W.body = W.donor = null;
      buildRest();
      rail.complete('goal');
    });
    cards.appendChild(b);
  }
  body.appendChild(cards);
}

/** The remaining steps depend on the goal, so they are rebuilt whenever it changes. */
function buildRest() {
  rail.truncateAfter('goal');
  rail.add('body', GOALS[W.goal].bodyQ, stepBody, () => W.body && W.body.name);
  if (W.goal === 'swap') {
    rail.add('donor', 'Whose clothes do you want?', stepDonor, () => W.donor && W.donor.name);
  }
  rail.add('export', 'Get the files out of the game', stepExport, () => 'exported');
  rail.add('drop', W.goal === 'swap' ? 'Load the body folder' : 'Load the folder',
    (b) => stepDrop(b, 'body'), () => (W.loadedBody || ''));
  if (W.goal === 'swap') {
    rail.add('drop2', 'Load the clothes folder', (b) => stepDrop(b, 'donor'),
      () => (W.loadedDonor || ''));
  }
}

// ---------------------------------------------------------------- 2/3. pick people
function characterPicker(body, { lit, note, exclude, onChoose, current }) {
  const wrap = el('div', 'picker');
  const left = el('div');

  left.appendChild(el('p', null, note));

  const list = allCharacters().filter((c) => !exclude || c.name !== exclude.name);
  const sel = el('select');
  sel.id = lit === 'body' ? 'wz-char' : 'wz-donor';
  const ph = el('option', null, '— choose —');
  ph.value = '';
  sel.appendChild(ph);

  const byF = {};
  for (const c of list) (byF[c.faction] = byF[c.faction] || []).push(c);
  for (const f of Object.keys(byF).sort()) {
    const og = document.createElement('optgroup');
    og.label = f;
    // Clone-safe first, then template-ready: the options that will work well should not be
    // buried under ones that will not.
    const sorted = [...byF[f]].sort((a, b) =>
      (a.blocks === 1 ? 0 : 1) - (b.blocks === 1 ? 0 : 1)
      || (b.template ? 1 : 0) - (a.template ? 1 : 0)
      || a.name.localeCompare(b.name));
    for (const c of sorted) {
      const own = c.sheets.filter((s) => s.part === 'ub' || s.part === 'lb')
        .map((s) => s.part).join(', ');
      const bits = [];
      if (lit === 'body' && c.blocks === 1) bits.push('✓ full detail');
      else if (lit === 'body') bits.push('⚠ loses detail if cloned');
      bits.push(own ? `own ${own}` : "wears another's textures");
      const o = el('option', null, `${c.name}   ${bits.join(' · ')}`);
      o.value = c.name;
      if (current && current.name === c.name) o.selected = true;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  left.appendChild(sel);

  const detail = el('div');
  left.appendChild(detail);
  wrap.appendChild(left);

  const fig = el('div', 'picker-fig');
  fig.innerHTML = person(lit, 0.8);
  fig.appendChild(el('div', 'fig-cap', lit === 'body' ? 'the body you become' : 'the clothes you wear'));
  wrap.appendChild(fig);
  body.appendChild(wrap);

  sel.addEventListener('change', () => {
    const c = list.find((x) => x.name === sel.value);
    detail.innerHTML = '';
    if (!c) return;
    detail.appendChild(describe(c, lit));
    const go = el('button', 'btn', 'Use ' + c.name);
    go.addEventListener('click', () => onChoose(c));
    const act = el('div', 'step-actions');
    act.appendChild(go);
    detail.appendChild(act);
  });
  if (current) sel.dispatchEvent(new Event('change'));
}

function describe(c, lit) {
  const box = el('div');
  const sheets = c.sheets.map((s) => `${s.part}${s.size ? ' ' + s.size : ''}`).join(' · ');
  box.appendChild(el('div', 'wz-sheets', `Sheets: ${sheets || 'none of its own'}`));
  if (lit === 'body') {
    if (c.blocks === 1) {
      box.appendChild(el('div', 'wz-ok',
        '✓ Keeps full detail. All of this character\'s geometry is in one place, so a copy '
        + 'looks exactly as sharp as the original.'));
    } else {
      box.appendChild(el('div', 'wz-warn',
        '⚠ A copy of this one loses detail. Its finer geometry lives in a second block a '
        + 'copy cannot carry, so it renders its coarsest version at every distance and the '
        + 'face visibly flattens. Fine if you are repainting it in place.'));
    }
  }
  if (!c.sheets.some((s) => s.part === 'ub' || s.part === 'lb')) {
    box.appendChild(el('div', 'wz-note',
      'Its textures are named after another character — it wears someone else\'s kit. That '
      + 'still exports and still works here; you just get the outfit it is seen in.'));
  }
  return box;
}

function stepBody(body) {
  characterPicker(body, {
    lit: 'body',
    current: W.body,
    note: W.goal === 'swap'
      ? 'Pick the character you want to BE — their body, face and build. You will pick whose clothes they wear next.'
      : 'Pick the character you want to work on.',
    onChoose: (c) => { W.body = c; onPick(c, W.goal); rail.complete('body'); },
  });
}

function stepDonor(body) {
  characterPicker(body, {
    lit: 'clothes',
    current: W.donor,
    exclude: W.body,
    note: 'Pick whoever is wearing the outfit you want. The two do not need matching texture '
      + 'layouts — the tool re-maps the clothing through the 3D body, so any pair works.',
    onChoose: (c) => { W.donor = c; rail.complete('donor'); },
  });
}

// ---------------------------------------------------------------- 4. export
function stepExport(body) {
  const names = W.goal === 'swap' ? [W.body.name, W.donor.name] : [W.body.name];

  body.appendChild(el('p', null,
    names.length > 1
      ? 'Two characters means two folders. Run both of these, then come back.'
      : 'Run this once, then come back.'));

  const f = el('label', 'wz-field');
  f.appendChild(el('span', null, 'Where should the files go?'));
  const out = el('input');
  out.type = 'text';
  out.value = W.outDir;
  out.spellcheck = false;
  f.appendChild(out);
  body.appendChild(f);

  const pre = el('pre');
  body.appendChild(pre);
  const upd = () => {
    W.outDir = (out.value || 'C:\\mercs2-skins').replace(/[\\/]+$/, '');
    // `.\` is required: PowerShell will not run an executable out of the current directory
    // without it, and the instructions tell people to cd into the tool's folder.
    pre.textContent = names
      .map((n) => `.\\mercs2_workshop --export-bundle ${n} --out "${W.outDir}"`).join('\n');
  };
  out.addEventListener('input', upd);
  upd();

  const act = el('div', 'step-actions');
  const copy = el('button', 'btn ghost', 'Copy');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(pre.textContent).then(
      () => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1400); },
      () => { copy.textContent = 'Select it manually'; });
  });
  act.appendChild(copy);
  const done = el('button', 'btn', "I've run it →");
  done.addEventListener('click', () => rail.complete('export'));
  act.appendChild(done);
  body.appendChild(act);

  body.appendChild(el('div', 'wz-note',
    `Each command writes a folder: ${names.map((n) => `${W.outDir}\\${n}\\`).join('  and  ')}. `
    + 'You will drag those in next — the tool checks each one before letting you continue, '
    + 'so you do not have to be sure you got it right.'));

  const tips = el('details', 'wz-tro');
  tips.appendChild(el('summary', null, 'The command did not work'));
  const ul = el('ul');
  for (const [q, a] of [
    ['"not recognized" or nothing happens',
      'You are not in the folder that holds mercs2_workshop.exe. cd into it first, or swap '
      + 'the .\\ for the full path to the exe. On Windows that leading .\\ is required.'],
    ['"no model ASET for 0x…"',
      'That name has no model of its own and cannot be exported. Every name in the pickers '
      + 'above has been checked, so this only happens if you typed one yourself.'],
    ['It cannot find vz.wad',
      'Run it from your Mercenaries 2 install, or pass the game path. It only ever reads '
      + 'the base WAD — it never modifies your install.'],
    ['I want all of them at once',
      'tools\\extract_all.bat fetches the entire roster — 85 characters, about 20 minutes — '
      + 'so you never have to run this again.'],
  ]) {
    const li = el('li');
    li.appendChild(el('b', null, q));
    li.appendChild(el('div', null, a));
    ul.appendChild(li);
  }
  tips.appendChild(ul);
  body.appendChild(tips);
}

// ---------------------------------------------------------------- 5/6. load + verify
function stepDrop(body, which) {
  const want = which === 'body' ? W.body : W.donor;
  body.appendChild(el('p', null,
    `Drag in the folder named ${want.name} — the one containing manifest.json. `
    + 'Not its parent, and not the files inside it.'));

  const zone = el('label', 'drop');
  const input = el('input');
  input.type = 'file';
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
  input.multiple = true;
  zone.appendChild(input);
  zone.appendChild(el('b', null, `Drop ${want.name}`));
  zone.appendChild(el('span', 'hint', `${W.outDir}\\${want.name}\\`));
  body.appendChild(zone);

  const out = el('div');
  body.appendChild(out);

  wireDrop(zone, input, async (files) => {
    out.innerHTML = '';
    if (!onNeedBundle) return;
    let res;
    try {
      res = await onNeedBundle(files, which);
    } catch (e) {
      out.appendChild(verdict({
        ok: false, title: 'That folder is not an export bundle',
        lines: [{ k: 'what came in', v: `${files.length} file(s)`, ok: false }],
        hint: (e && e.message ? e.message.split('\n')[0] : '')
          + ' — drop the folder named after the character, the one with manifest.json in it.',
      }));
      return;
    }

    // ★ Check they dropped the RIGHT character, not just a valid one. Dropping the body
    // twice, or the two folders the wrong way round, is the single easiest mistake to make
    // here and produces a confusing result rather than an error.
    const got = res.name;
    const right = got.toLowerCase() === want.name.toLowerCase();
    const sheets = res.sheets || 0;
    const lines = [
      { k: 'character', v: got, ok: right },
      { k: 'expected', v: want.name },
      { k: 'textures', v: `${res.textures} decoded`, ok: res.textures > 0 },
      { k: 'body sheets', v: sheets ? `${sheets} painted` : 'none', ok: sheets > 0 },
    ];
    if (!right) {
      out.appendChild(verdict({
        ok: false, title: `That is ${got}, not ${want.name}`,
        lines,
        hint: which === 'donor'
          ? 'You may have dropped the body folder again. The clothes folder is the second '
            + 'character you exported.'
          : 'Drop the folder for the character you picked, or go back and pick this one instead.',
      }));
      return;
    }
    if (!res.textures) {
      out.appendChild(verdict({
        ok: false, title: 'That bundle has no textures',
        lines,
        hint: 'The export is missing its textures folder. Re-run the command and drag the '
          + 'whole character folder in, not just part of it.',
      }));
      return;
    }
    out.appendChild(verdict({
      ok: true, title: `${got} loaded`,
      lines: [
        { k: 'textures', v: `${res.textures} decoded` },
        { k: 'body sheets', v: `${sheets} painted` },
        { k: 'geometry', v: `${res.tris.toLocaleString()} triangles` },
      ],
    }));
    const act = el('div', 'step-actions');
    const go = el('button', 'btn', 'Continue →');
    go.addEventListener('click', () => {
      if (which === 'body') { W.loadedBody = got; rail.complete('drop'); }
      else { W.loadedDonor = got; rail.complete('drop2'); }
      if (res.onContinue) res.onContinue();
    });
    act.appendChild(go);
    out.appendChild(act);
  });
}

export const wizardState = W;
