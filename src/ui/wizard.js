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

import { el, wireDrop } from './dom.js';
import { Rail, verdict } from './rail.js';
import { ART, person } from './figure.js';
import { SAMPLE } from '../sample.js';

let CAT = null;
let onPick = () => {};
let onNeedBundle = null;
let onApplySample = async () => { throw new Error('not wired'); };
let rail = null;

export function setCatalogue(c) { CAT = c; }
export function onDonorPicked(fn) { onPick = fn; }
/** app.js supplies the folder reader so the wizard can verify a drop before advancing. */
export function setBundleLoader(fn) { onNeedBundle = fn; }
/** app.js supplies the sample loader, since it owns image decoding and the edit state. */
export function setSampleApplier(fn) { onApplySample = fn; }

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

// Each goal carries a plain-language `eg` as well as a description. The description says
// what the option DOES, in the tool's own vocabulary -- "outfits", "textures", "clone" --
// and someone who has never modded this game has no way to judge which of those they want.
// The `eg` says what it is FOR, in a sentence with no jargon in it at all, so the choice can
// be made on intent even when the terminology means nothing yet.
const GOALS = {
  variants: {
    title: 'Add new outfits',
    sub: 'Extra skins that sit alongside the original. Nothing in the game changes until you choose to wear one.',
    eg: 'For when you want the original to stay exactly as it is, but be able to spawn new versions of it too.',
    bodyQ: 'Which character?',
  },
  replace: {
    title: 'Change how someone looks',
    sub: "Repaint a character's own textures. Everyone who wears them changes.",
    eg: 'For when you want every soldier of that type in the game to be wearing your new uniform.',
    bodyQ: 'Which character?',
  },
  swap: {
    title: "Wear someone else's outfit",
    sub: 'Put one character\'s clothing onto another. No painting at all — the tool does the work.',
    eg: 'For when you want Chris in Allied fatigues, and you do not want to paint anything yourself.',
    bodyQ: 'Whose body are you dressing?',
  },
  tutorial: {
    title: 'Try a finished example',
    sub: 'Walk one ready-made skin all the way through, from the stock model to something you can wear in game.',
    eg: 'For when you have never done this before and want to see it work once before you make anything.',
    bodyQ: null,
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
  for (const id of ['variants', 'replace', 'swap', 'tutorial']) {
    const g = GOALS[id];
    const b = el('button', 'card' + (W.goal === id ? ' sel' : ''));
    b.type = 'button';
    const art = el('div', 'card-art');
    art.innerHTML = ART[id]();
    b.appendChild(art);
    b.appendChild(el('div', 'card-t', g.title));
    b.appendChild(el('div', 'card-s', g.sub));
    b.appendChild(el('div', 'card-eg', g.eg));
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

  // The tutorial has no choices in it at all -- that is the point. The character is fixed,
  // the skin is fixed, and the only thing asked of the user is to run one command and drag
  // one folder back. Nothing to get wrong means nothing to explain.
  if (W.goal === 'tutorial') {
    W.body = allCharacters().find((c) => c.name === SAMPLE.character)
      || { name: SAMPLE.character, sheets: [], blocks: 1 };
    onPick(W.body, 'tutorial');
    rail.add('export', `Get ${SAMPLE.character} out of the game`, stepExport, () => 'exported');
    rail.add('drop', 'Load the folder', (b) => stepDrop(b, 'body'), () => (W.loadedBody || ''));
    rail.add('apply', 'Put the example skin on it', stepApplySample, () => SAMPLE.name);
    rail.add('install', 'Get it into the game', stepInstall, () => 'done');
    return;
  }

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

/**
 * Rank a character for the job at hand: green best, amber workable, red costs something.
 *
 * ★ `cloning` matters, and it is why this is not one fixed scale. Copying a two-block
 * character loses its finer LOD rungs and flattens its face -- but NOTHING is copied when
 * you repaint a character in place, and nothing is copied from an outfit DONOR either
 * (only its artwork and body shape are read). Painting those red would steer people away
 * from choices that are perfectly correct for what they are doing.
 *
 * So: the LOD tier only counts when a copy will actually be made. Otherwise the only thing
 * that separates characters is whether the textures belong to them alone.
 */
export function tier(c, cloning) {
  const own = (c.sheets || []).some((s) => s.part === 'ub' || s.part === 'lb');
  if (cloning && c.blocks !== 1) {
    return { rank: 2, cls: 'opt-bad', tag: 'loses detail if copied' };
  }
  if (own) {
    return { rank: 0, cls: 'opt-good', tag: cloning ? 'full detail · own textures' : 'own textures' };
  }
  return { rank: 1, cls: 'opt-ok', tag: cloning ? 'full detail · shared textures' : 'shared textures' };
}

const LEGEND = {
  'opt-good': 'best pick',
  'opt-ok': 'shared textures — it wears another character\'s kit',
  'opt-bad': 'a copy of this one renders its coarsest detail at every distance',
};

function legendRow(cloning) {
  const row = el('div', 'legend');
  const keys = cloning ? ['opt-good', 'opt-ok', 'opt-bad'] : ['opt-good', 'opt-ok'];
  for (const k of keys) {
    const chip = el('span', 'legend-item');
    chip.appendChild(el('span', `dot ${k}`, '●'));
    chip.appendChild(el('span', null, LEGEND[k]));
    row.appendChild(chip);
  }
  return row;
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

  // A copy is only made when a NEW asset is minted: adding outfits, or wearing someone
  // else's on your own body. Repainting in place clones nothing, and neither does reading
  // a donor's artwork.
  const cloning = lit === 'body' && W.goal !== 'replace';
  left.appendChild(legendRow(cloning));

  const byF = {};
  for (const c of list) (byF[c.faction] = byF[c.faction] || []).push(c);
  for (const f of Object.keys(byF).sort()) {
    const og = document.createElement('optgroup');
    og.label = f;
    // Best tier first, then template-ready: the options that will work well should not be
    // buried under ones that will not.
    const sorted = [...byF[f]].sort((a, b) =>
      tier(a, cloning).rank - tier(b, cloning).rank
      || (b.template ? 1 : 0) - (a.template ? 1 : 0)
      || a.name.localeCompare(b.name));
    for (const c of sorted) {
      const t = tier(c, cloning);
      // The dot carries the colour, the words carry the meaning. Colour alone would be
      // useless to anyone who cannot separate red from green, and <option> cannot hold
      // markup -- so the tag is spelled out in the text either way.
      const o = el('option', t.cls, `● ${c.name}   ${t.tag}`);
      o.value = c.name;
      if (current && current.name === c.name) o.selected = true;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  left.appendChild(sel);

  // The closed select shows one option, and browsers do not carry the option's colour up
  // to it. Restate the tier on the control itself so the current choice stays legible
  // without opening the list -- and so the meaning survives a browser that ignores option
  // colours entirely.
  const paint = () => {
    const c = list.find((x) => x.name === sel.value);
    sel.classList.remove('sel-good', 'sel-ok', 'sel-bad');
    if (c) sel.classList.add(tier(c, cloning).cls.replace('opt-', 'sel-'));
  };
  sel.addEventListener('change', paint);

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
    detail.appendChild(describe(c, cloning));
    const go = el('button', 'btn', 'Use ' + c.name);
    go.addEventListener('click', () => onChoose(c));
    const act = el('div', 'step-actions');
    act.appendChild(go);
    detail.appendChild(act);
  });
  if (current) sel.dispatchEvent(new Event('change'));
}

function describe(c, cloning) {
  const box = el('div');
  const sheets = c.sheets.map((s) => `${s.part}${s.size ? ' ' + s.size : ''}`).join(' · ');
  box.appendChild(el('div', 'wz-sheets', `Sheets: ${sheets || 'none of its own'}`));
  // Only raised where a copy is actually made. Under "change how someone looks" nothing is
  // cloned, so a two-block character is not a compromise at all and saying so would push
  // people off a perfectly good choice.
  if (cloning) {
    if (c.blocks === 1) {
      box.appendChild(el('div', 'wz-ok',
        '✓ Keeps full detail. All of this character\'s geometry is in one place, so a copy '
        + 'looks exactly as sharp as the original.'));
    } else {
      box.appendChild(el('div', 'wz-warn',
        '⚠ A copy of this one loses detail. Its finer geometry lives in a second block a '
        + 'copy cannot carry, so it renders its coarsest version at every distance and the '
        + 'face visibly flattens. Fine if you are repainting it in place instead.'));
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

// ---------------------------------------------------------------- tutorial only
function stepApplySample(body) {
  body.appendChild(el('p', null,
    'This is a finished skin that ships with the tool — a wireframe-and-neon repaint of the '
    + "mechanic's overalls. Its upper and lower body sheets replace the stock ones; the head "
    + 'and hair are deliberately left alone so he still reads as a person.'));

  const shots = el('div', 'sample-shots');
  for (const s of SAMPLE.sheets) {
    const fig = el('div', 'sample-shot');
    const img = el('img');
    img.src = SAMPLE.dir + s.file;
    img.alt = s.part;
    img.loading = 'lazy';
    fig.appendChild(img);
    fig.appendChild(el('div', 'fig-cap', s.part));
    shots.appendChild(fig);
  }
  body.appendChild(shots);

  const out = el('div');
  const act = el('div', 'step-actions');
  const go = el('button', 'btn', 'Apply it →');
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'applying…';
    out.innerHTML = '';
    try {
      const res = await onApplySample();
      out.appendChild(verdict({
        ok: true,
        title: 'Applied',
        lines: res.applied.map((a) => ({ k: a.part, v: `${a.name} · ${a.w}×${a.h}` })),
      }));
      rail.complete('apply');
    } catch (e) {
      go.disabled = false;
      go.textContent = 'Apply it →';
      out.appendChild(verdict({
        ok: false,
        title: 'Could not load the example images',
        lines: [{ k: 'reason', v: (e && e.message) || 'fetch failed', ok: false }],
        hint: 'The single-file offline build cannot read the samples folder. Use the hosted '
          + 'version at skins.mercs2.tools for this walkthrough, or keep the samples folder '
          + 'next to the HTML file.',
      }));
    }
  });
  act.appendChild(go);
  body.appendChild(act);
  body.appendChild(out);
}

function stepInstall(body) {
  body.appendChild(el('p', null,
    'The skin is loaded and the panels below now hold the real thing — the sheets, the 3D '
    + 'preview and both export routes. Everything from here is the ordinary flow.'));

  const ol = el('ol', 'howto');
  for (const [t, d] of [
    ['Look at it first',
      'Scroll down to the 3D preview and turn the model around. What you see there is what '
      + 'the game will show.'],
    ['Download the new-asset kit',
      'In Export, take “Download new-asset kit”. It contains the encoded textures and a '
      + 'build script with every command already filled in.'],
    ['Run the two commands in that script',
      'They mint a new model and new textures under a new name and pack them into a patch '
      + 'WAD. Your game files are not touched — this only ever adds.'],
    ['Install the patch',
      'Import the patch in the modkit, or if you have no other mods, drop it in as '
      + 'data\\vz-patch.wad.'],
  ]) {
    const li = el('li');
    li.appendChild(el('b', null, t));
    li.appendChild(el('div', null, d));
    ol.appendChild(li);
  }
  body.appendChild(ol);

  body.appendChild(el('div', 'wz-q', 'Then wear it'));
  const pre = el('pre');
  pre.textContent = `Player.SetOutfit(Player.GetLocalCharacter(), "${SAMPLE.name}")`;
  body.appendChild(pre);

  // ⚠ This is the one genuinely dangerous instruction in the whole tool, so it is stated
  // plainly rather than buried: an unresolvable outfit name does not fail softly.
  body.appendChild(el('div', 'wz-warn',
    '⚠ Only run that once the patch is actually installed and loaded. Asking the game for '
    + 'an outfit name it cannot find crashes it to desktop — there is no soft failure. If '
    + 'you renamed the skin, use your name here, exactly as you typed it.'));

  const act = el('div', 'step-actions');
  const done = el('button', 'btn', 'Got it');
  done.addEventListener('click', () => rail.complete('install'));
  act.appendChild(done);
  body.appendChild(act);
}

export const wizardState = W;
