// pandemic_hash_m2 decides every asset name's identity. A wrong hash silently produces an
// asset nothing can find, or worse, collides with a real one -- so it is pinned against
// all 80 recovered bone names of the human skeleton, which are known name/hash pairs.

import { readFileSync, existsSync } from 'node:fs';
import { pandemicHashM2, hex8, sanitizeAssetName, preflight, planExport, buildCommands } from '../src/export.js';

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

  // planExport / buildCommands on a minimal fake bundle
  const bundle = {
    name: 'civ_hum_beachfemale_a',
    manifest: { lod_chain: [{ block: 2110 }] },
    textures: [{ hash: '0x8DE46BB7', roles: ['diffuse'], width: 256, height: 256, primitives: [] }],
    prims: [
      { name: 'LOD0_group0', material: { extras: { diffuse: '0x8DE46BB7' } } },
      { name: 'LOD1_group1', material: { extras: { diffuse: '0x8DE46BB7' } } },
    ],
  };
  const plan = planExport({ bundle, texture: bundle.textures[0], skinName: 'Red Variant' });
  t.eq('model asset name', plan.modelName, 'red_variant');
  t.eq('texture asset name carries the role', plan.texName, 'red_variant_diffuse');
  t.ok('a shared texture is warned about', !!plan.sharedWarning, 'no warning produced');

  const cmd = buildCommands({ bundle, texture: bundle.textures[0], plan });
  t.ok('command block repoints the ORIGINAL hash at the new one',
    cmd.includes(`--repoint 0x8DE46BB7:${hex8(plan.texHash)}`), cmd);
  t.ok('command block clones the raw block rather than editing in place',
    cmd.includes('inject_parts raw/block2110_P000.ucfx'));
  t.ok('command block never overwrites the original asset',
    !cmd.includes('--replace-tex') && cmd.includes('--inject-extra'));
  t.ok('command block ends with how to wear it', cmd.includes('Player.SetOutfit'));
}
