// Additive export: publish a NEW skin rather than overwrite an existing texture.
//
// Overwriting texture 0x8DE46BB7 changes it for EVERY model that references it -- and
// textures are shared across LOD rungs and, at 36,724 textures game-wide, very likely
// across characters too. So the flow here mints new assets and leaves the originals alone:
//
//   1. a NEW texture asset, named by the user, hashed with pandemic_hash_m2
//   2. a NEW model asset cloned from the donor's ORIGINAL block bytes (bundle raw/),
//      with its material texture references repointed at (1) via inject_parts --repoint
//
// The original character is untouched and the new one is selectable by name in Lua.

/** pandemic_hash_m2 -- FNV-1a 32-bit, case-folded with `| 0x20`, finalised `^ 0x2A` then
 *  one more multiply by the FNV prime. Verified against all 80 named bones of the human
 *  skeleton. Case-insensitive, so "MySkin" and "myskin" collide by design. */
export function pandemicHashM2(text) {
  if (!text.length) return 0;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ (text.charCodeAt(i) | 0x20)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = (h ^ 0x2a) >>> 0;
  return Math.imul(h, 0x01000193) >>> 0;
}

export const hex8 = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** Asset names are hashed case-insensitively and land in a flat namespace, so keep them
 *  distinctive and lowercase. */
export function sanitizeAssetName(s) {
  return (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'skin').slice(0, 48);
}

/**
 * Work out what to emit for one edited texture.
 * @param {{bundle, texture, skinName, replacedBy}} o
 */
export function planExport({ bundle, texture, skinName }) {
  const modelName = sanitizeAssetName(skinName);
  const texName = `${modelName}_${(texture.roles[0] || 'tex')}`;
  const texHash = pandemicHashM2(texName);
  const modelHash = pandemicHashM2(modelName);

  // Which other draw groups share this exact texture? Repointing only the edited one
  // leaves the rest of the model on the original sheet, which is usually a surprise.
  const sharing = bundle.textures.filter((t) => t.hash === texture.hash);
  const alsoUsedBy = bundle.prims.filter((p) => {
    const e = p.material.extras || {};
    return e.diffuse === texture.hash || e.normal === texture.hash || e.specular === texture.hash;
  }).map((p) => p.name);

  const rawFiles = Object.keys(bundle.manifest.lod_chain || {}).length
    ? []
    : (bundle.manifest.lod_chain || []).map((l) => `block${l.block}`);

  return {
    modelName, modelHash, texName, texHash,
    textureFile: `${texName}.ucfx`,
    alsoUsedBy,
    sharedWarning: alsoUsedBy.length > 1
      ? `Texture ${texture.hash} is referenced by ${alsoUsedBy.length} draw groups ` +
        `(${alsoUsedBy.slice(0, 3).join(', ')}${alsoUsedBy.length > 3 ? ' …' : ''}). ` +
        `Repointing swaps it for all of them on the new model — usually what you want, ` +
        `but check the preview.`
      : null,
    rawFiles,
  };
}

/** The command block for the additive path. */
export function buildCommands({ bundle, texture, plan }) {
  const lod = (bundle.manifest.lod_chain || [])[0];
  const rawName = lod ? `block${lod.block}_P000.ucfx` : 'block<N>_P000.ucfx';
  return [
    `# ADDITIVE reskin of "${bundle.name}" — the original model and texture are untouched.`,
    `#`,
    `# new texture asset : ${plan.texName}  ${hex8(plan.texHash)}`,
    `# new model  asset : ${plan.modelName}  ${hex8(plan.modelHash)}`,
    `# repoint          : ${texture.hash} -> ${hex8(plan.texHash)}`,
    ``,
    `# 1. clone the donor's ORIGINAL block bytes into a new-hash model whose materials`,
    `#    point at your texture instead. raw/ came with the export bundle.`,
    `inject_parts raw/${rawName} ${plan.modelName}.ucfx \\`,
    `    --name-hash ${hex8(plan.modelHash)} \\`,
    `    --repoint ${texture.hash}:${hex8(plan.texHash)}`,
    ``,
    `# 2. put BOTH new assets into a patch WAD (texture type_id 27, model type_id 19)`,
    `mercs2_smuggler --inject-extra ${hex8(plan.texHash)}:27:${plan.textureFile} \\`,
    `                --inject-extra ${hex8(plan.modelHash)}:19:${plan.modelName}.ucfx \\`,
    `                --out ${plan.modelName}-patch.wad`,
    ``,
    `# 3. merge into the live patch — the engine mounts exactly ONE <name>-patch.wad`,
    `merge_patches "<game>/data/vz-patch.wad" ${plan.modelName}-patch.wad out.wad --replace`,
    `cp out.wad "<game>/data/vz-patch.wad"`,
    ``,
    `# 4. wear it in-game`,
    `#    Player.SetOutfit(Player.GetLocalCharacter(), "${plan.modelName}")`,
  ].join('\n');
}

/** Checks that stop a texture the engine will reject or mis-stream. */
export function preflight({ width, height, texture, name }) {
  const out = [];
  const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
  out.push({
    id: 'pow2', title: 'Power-of-two size', ok: pow2(width) && pow2(height),
    text: `${width}x${height}`,
    detail: 'DXT block compression and the mip chain both require power-of-two dimensions.',
  });
  const same = texture ? width === texture.width && height === texture.height : true;
  out.push({
    id: 'dims', title: 'Matches the original', ok: same,
    text: texture ? `${width}x${height} vs original ${texture.width}x${texture.height}` : `${width}x${height}`,
    detail: 'A different size still works, but the texture pool has a 5120-cell cap — ' +
      'upscaling a 256 sheet to 1024 costs 16x the budget for no visible gain at ' +
      'gameplay distance.',
  });
  out.push({
    id: 'name', title: 'Asset name', ok: !!sanitizeAssetName(name) && sanitizeAssetName(name) !== 'skin',
    text: sanitizeAssetName(name) || '(empty)',
    detail: 'Names are hashed case-insensitively into a flat namespace. Pick something ' +
      'distinctive — a collision silently replaces an existing asset.',
  });
  out.push({
    id: 'budget', title: 'Texture memory', ok: width * height <= 1024 * 1024,
    text: `${((width * height) / 1024 / 1024).toFixed(2)} Mpx`,
    detail: 'Above 1024x1024 you are eating a disproportionate share of the texture pool.',
  });
  return out;
}
