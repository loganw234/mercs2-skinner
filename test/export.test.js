// pandemic_hash_m2 decides every asset name's identity. A wrong hash silently produces an
// asset nothing can find, or worse, collides with a real one -- so it is pinned against
// all 80 recovered bone names of the human skeleton, which are known name/hash pairs.

import { readFileSync, existsSync } from 'node:fs';
import { pandemicHashM2, hex8, sanitizeAssetName, preflight, planExport, buildCommands, buildModkitMod } from '../src/export.js';

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
  t.ok('command block repoints BOTH edited textures',
    cmd.includes(`0x8DE46BB7:${hex8(plan.items[0].texHash)}`) &&
    cmd.includes(`0xD7DE49F7:${hex8(plan.items[1].texHash)}`), cmd);
  // Assert on the RUNNABLE lines only: the block deliberately explains in comments why
  // inject_parts is not used, and that prose must not trip these checks.
  const runnable = cmd.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n');
  t.eq('exactly one repoint invocation', (runnable.match(/repoint_model\.py/g) || []).length, 1);
  t.ok('command block clones the raw block rather than editing in place',
    runnable.includes('repoint_model.py raw/block2110_P000.ucfx'));
  // inject_parts REQUIRES at least one --part, so it cannot express "same mesh, different
  // textures" -- verified against the real binary, which printed usage and refused. This
  // assertion exists so that dead end is never re-emitted.
  t.ok('does NOT run inject_parts, which requires a --part', !runnable.includes('inject_parts'));
  // --extra-only is what makes the pack additive: "add blocks, never touch a donor block".
  t.ok('packs with --extra-only so no donor block is touched', runnable.includes('--extra-only'));
  t.ok('every new texture is injected', (runnable.match(/--inject-extra/g) || []).length === 3,
    'expected 2 textures + 1 model');
  t.ok('command block ends with how to wear it', cmd.includes('Player.SetOutfit'));

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
  t.ok('the new-asset path still covers the unnamed texture',
    buildCommands({ bundle, plan: anon }).includes('0xB8555125:'));
}
