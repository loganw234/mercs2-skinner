// pandemic_hash_m2 decides every asset name's identity. A wrong hash silently produces an
// asset nothing can find, or worse, collides with a real one -- so it is pinned against
// all 80 recovered bone names of the human skeleton, which are known name/hash pairs.

import { readFileSync, existsSync } from 'node:fs';
import { pandemicHashM2, hex8, sanitizeAssetName, preflight, planExport, buildCommands, buildNotes, buildModkitMod } from '../src/export.js';

const SKEL = 'C:/Users/logan/source/repos/mercs2-mesher/data/skeleton_npc84.json';

export function run(t) {
  if (existsSync(SKEL)) {
    const sk = JSON.parse(readFileSync(SKEL, 'utf8'));
    let ok = 0, bad = [];
    for (const b of sk.bones) {
      if (b.name.startsWith('hash_')) continue;
      const got = pandemicHashM2(b.name).toString(16).toUpperCase().padStart(8, '0');
      if (got === b.hash) ok++; else if (bad.length < 3) bad.push(`${b.name}: ${got} != ${b.hash}`);
    }
    t.eq(`pandemic_hash_m2 matches all ${ok} known bone name/hash pairs`, bad.length, 0);
    t.ok(`${ok} pairs verified`, ok >= 80, `only ${ok}`);
  } else {
    t.skip('hash vs known bone names', 'needs ../mercs2-mesher/data/skeleton_npc84.json');
  }

  // Known-good spot values, so the test still bites without the sibling repo.
  t.eq('hash("Bone_Hips")', hex8(pandemicHashM2('Bone_Hips')), '0x24C5009C');
  t.eq('hash("GlobalSRT")', hex8(pandemicHashM2('GlobalSRT')), '0xCBC1EB51');
  t.eq('empty string hashes to 0', pandemicHashM2(''), 0);

  // Case-insensitivity is a REAL hazard: two names differing only in case are the same
  // asset, so the UI must not let a user think they made a distinct skin.
  t.eq('hashing is case-insensitive', pandemicHashM2('MySkin'), pandemicHashM2('myskin'));
  t.eq('...and for mixed case', pandemicHashM2('BoNe_HiPs'), pandemicHashM2('BONE_HIPS'));

  t.eq('sanitize collapses punctuation runs', sanitizeAssetName('50 Cent -- Red!!'), '50_cent_red');
  t.eq('sanitize falls back', sanitizeAssetName('!!!'), 'skin');

  // Preflight
  const tex = { width: 256, height: 256, roles: ['diffuse'], hash: '0xAAAA' };
  const okp = preflight({ width: 256, height: 256, texture: tex, name: 'my_skin' });
  t.ok('a matching power-of-two sheet passes every check', okp.every((c) => c.ok),
    JSON.stringify(okp.filter((c) => !c.ok).map((c) => c.title)));
  const bad = preflight({ width: 300, height: 256, texture: tex, name: 'my_skin' });
  t.ok('non-power-of-two fails', !bad.find((c) => c.id === 'pow2').ok);
  const big = preflight({ width: 2048, height: 2048, texture: tex, name: 'my_skin' });
  t.ok('an oversized sheet is flagged against the texture pool', !big.find((c) => c.id === 'budget').ok);
  t.ok('an upscale away from the original is flagged', !big.find((c) => c.id === 'dims').ok);

  // planExport / buildCommands / buildModkitMod on a minimal fake bundle
  const texUB = { hash: '0x8DE46BB7', roles: ['diffuse'], width: 256, height: 256, primitives: [], triangles: 100 };
  const texLB = { hash: '0xD7DE49F7', roles: ['diffuse'], width: 256, height: 256, primitives: [], triangles: 80 };
  const texHair = { hash: '0xB8555125', roles: ['diffuse'], width: 128, height: 128, primitives: [], triangles: 20 };
  const bundle = {
    name: 'civ_hum_beachfemale_a',
    manifest: { lod_chain: [{ block: 2110 }] },
    textures: [texUB, texLB, texHair],
    prims: [
      { name: 'LOD0_group0', material: { extras: { diffuse: '0x8DE46BB7' } } },
      { name: 'LOD1_group1', material: { extras: { diffuse: '0x8DE46BB7' } } },
      { name: 'LOD0_group2', material: { extras: { diffuse: '0xD7DE49F7' } } },
    ],
  };

  // --- MULTI-TEXTURE: the sheet issue. A uniform spans several sheets, so both exports
  // must cover the whole edit set or the character comes out half-reskinned.
  const edits = [
    { texture: texUB, name: 'civ_hum_beachfemale_a_ub' },
    { texture: texLB, name: 'civ_hum_beachfemale_a_lb' },
  ];
  const plan = planExport({ bundle, edits, skinName: 'Red Variant' });
  t.eq('model asset name', plan.modelName, 'red_variant');
  t.eq('one plan item per edited texture', plan.items.length, 2);
  t.eq('texture name strips the donor prefix', plan.items[0].texName, 'red_variant_ub');
  t.ok('each edited texture gets its own hash',
    plan.items[0].texHash !== plan.items[1].texHash);
  t.ok('an unedited sheet is reported as incomplete', !!plan.incompleteWarning,
    'hair was left original and should have been flagged');
  t.ok('the incomplete warning names the untouched sheet',
    /0xB8555125|hair/.test(plan.incompleteWarning), plan.incompleteWarning);

  const cmd = buildCommands({ bundle, plan });
  // Assert on the RUNNABLE lines only: the script deliberately explains itself in `rem`
  // comments and echoes prose, and none of that must trip these checks.
  const runnable = cmd.split('\r\n')
    .filter((l) => l.trim() && !/^\s*(rem\b|echo\b|:)/i.test(l.trim())).join('\n');

  // ★ The model is repointed in the browser now (src/repoint.js) and shipped ready-made in
  // the zip, so the script must NOT ask for an interpreter. The additive path is the one
  // that cannot damage anyone's game; requiring a Python install to use it was backwards.
  t.ok('no Python step survives', !/python|\.py\b/i.test(cmd), cmd.slice(0, 300));
  t.ok('the ready-made model is what gets injected',
    runnable.includes(`${plan.modelName}.ucfx`));
  // inject_parts REQUIRES at least one --part, so it cannot express "same mesh, different
  // textures" -- verified against the real binary, which printed usage and refused. This
  // assertion exists so that dead end is never re-emitted.
  t.ok('does NOT run inject_parts, which requires a --part', !runnable.includes('inject_parts'));
  // --extra-only is what makes the pack additive: "add blocks, never touch a donor block".
  t.ok('packs with --extra-only so no donor block is touched', runnable.includes('--extra-only'));
  t.ok('every new asset is injected', (runnable.match(/--inject-extra/g) || []).length === 3,
    'expected 2 textures + 1 model');
  t.ok('textures are injected under type 27',
    runnable.includes(`${hex8(plan.items[0].texHash)}:27:`));
  t.ok('the model is injected under type 19',
    runnable.includes(`${hex8(plan.modelHash)}:19:`));
  t.ok('the script says how to wear it', cmd.includes('Player.SetOutfit'));
  // A .bat that dies without saying why is worse than no .bat: the window vanishes.
  t.ok('it pauses so a failure is readable', /pause/.test(cmd));
  t.ok('it checks the packer exists before running it', /Could not find mercs2_smuggler/.test(cmd));
  t.ok('it checks the game WAD exists', /Could not find vz\.wad/.test(cmd));
  t.ok('batch line endings are CRLF', cmd.includes('\r\n') && !/[^\r]\n/.test(cmd));

  const notes = buildNotes({ bundle, plan });
  t.ok('the notes name every file in the kit',
    notes.includes(`${plan.modelName}.ucfx`) && notes.includes('install.bat')
    && plan.items.every((i) => notes.includes(i.file)));
  t.ok('the notes give the non-Windows command', notes.includes('mercs2_smuggler --source-wad'));
  t.ok('the notes state the crash risk plainly', /crashes it to desktop/.test(notes));

  // --- MODKIT PATH ---
  const mk = buildModkitMod({ bundle, plan, skinName: 'Red Variant' });
  t.eq('modkit mod declares its kind', mk.mod.kind, 'texture-swap');
  t.eq('one swap per edited texture', mk.mod.textures.length, 2);
  t.eq('swaps target the ENGINE NAME, which is what TextureSwap.name expects',
    mk.mod.textures[0].name, 'civ_hum_beachfemale_a_ub');
  t.ok('swaps carry an image_path the packer can resolve',
    mk.mod.textures.every((x) => x.image_path.startsWith('textures/') && x.image_path.endsWith('.png')));
  t.ok('mod json parses', (() => { try { JSON.parse(mk.json); return true; } catch { return false; } })());
  t.ok('nothing is blocked when every texture has a name', !mk.blocked);

  // A texture whose name was never recovered CANNOT be swapped by the modkit -- it must be
  // reported, not silently dropped, or the user ships a mod missing a sheet.
  const anon = planExport({
    bundle, skinName: 'Red Variant',
    edits: [{ texture: texUB, name: 'civ_hum_beachfemale_a_ub' }, { texture: texHair, name: null }],
  });
  const mkAnon = buildModkitMod({ bundle, plan: anon, skinName: 'Red Variant' });
  t.eq('unnamed textures are excluded from the modkit swap list', mkAnon.mod.textures.length, 1);
  t.ok('and are reported rather than dropped silently', !!mkAnon.blocked, 'no blocked message');
  t.ok('the blocked message names the offending hash', mkAnon.blocked.includes('0xB8555125'));
  // The modkit path cannot carry a texture whose engine name was never recovered, because
  // it swaps BY NAME. The new-asset path does not care -- it mints a fresh name -- so the
  // sheet must still ship there rather than being quietly lost between the two routes.
  const anonItem = anon.items.find((i) => i.originalHash === '0xB8555125');
  t.ok('the unnamed texture still gets a plan item', !!anonItem);
  t.ok('the new-asset path still ships the unnamed texture',
    buildCommands({ bundle, plan: anon }).includes(`${hex8(anonItem.texHash)}:27:`));
}
