// Additive export: publish a NEW skin rather than overwrite an existing texture.
//
// Overwriting texture 0x8DE46BB7 changes it for EVERY model that references it -- and
// textures are shared across LOD rungs and, at 36,724 textures game-wide, very likely
// across characters too. So the flow here mints new assets and leaves the originals alone:
//
//   1. a NEW texture asset, named by the user, hashed with pandemic_hash_m2
//   2. a NEW model asset cloned from the donor's ORIGINAL block bytes (bundle raw/),
//      with its material texture references repointed at (1) -- see buildCommands()
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
 * Plan an export covering EVERY edited texture, not just the selected one.
 *
 * A uniform spans several sheets -- this character alone splits into head / upper body /
 * lower body / hair -- so planning one texture at a time produces a character with a
 * repainted torso and a stock face. Both export paths take the whole edit set.
 *
 * @param {{bundle, edits: Array<{texture, name}>, skinName}} o
 */
export function planExport({ bundle, edits, skinName }) {
  const modelName = sanitizeAssetName(skinName);
  const modelHash = pandemicHashM2(modelName);

  const items = edits.map(({ texture, name }) => {
    // Stem from the RECOVERED engine name so the new asset keeps its identity obvious.
    // Strip the donor's own prefix first: `civ_hum_beachfemale_a_ub` under donor
    // `civ_hum_beachfemale_a` should yield `myskin_ub`, not `myskin_a_ub`.
    let stem;
    if (name) {
      const base = bundle.name || '';
      stem = name.toLowerCase().startsWith(base.toLowerCase() + '_')
        ? name.slice(base.length + 1)
        : name.split('_').slice(-2).join('_');
    } else {
      stem = texture.roles[0] || 'tex';
    }
    const texName = `${modelName}_${sanitizeAssetName(stem)}`;
    return {
      texture,
      originalName: name,
      originalHash: texture.hash,
      texName,
      texHash: pandemicHashM2(texName),
      file: `${texName}.ucfx`,
      pngFile: `${name || texture.hash}.png`,
    };
  });

  // Which draw groups reference each edited texture? Repointing swaps it for all of them
  // on the new model, which is normally what you want but worth stating.
  const usedBy = (hash) => bundle.prims.filter((p) => {
    const e = p.material.extras || {};
    return e.diffuse === hash || e.normal === hash || e.specular === hash;
  }).map((p) => p.name);

  // Textures the model uses that were NOT edited -- the "half-recoloured soldier" trap.
  const untouched = bundle.textures.filter(
    (t) => t.triangles > 0 && !items.some((i) => i.originalHash === t.hash));

  return {
    modelName, modelHash, items,
    untouched,
    incompleteWarning: untouched.length
      ? `${untouched.length} texture(s) on this model are still the original: ` +
        `${untouched.slice(0, 4).map((t) => t.name || t.hash).join(', ')}` +
        `${untouched.length > 4 ? ' …' : ''}. A skin that only covers some sheets shows ` +
        `up in game as a half-reskinned character.`
      : null,
    sharedWarning: items.some((i) => usedBy(i.originalHash).length > 1)
      ? 'Some edited textures are referenced by several draw groups; the swap applies to ' +
        'all of them. Check the preview.'
      : null,
  };
}

/** The additive path: mint NEW texture + model assets, originals untouched.
 *
 *  This recipe was RUN, not inferred. Two corrections came out of doing it for real:
 *  `inject_parts --repoint` cannot express a reskin (it requires at least one `--part`,
 *  and refuses otherwise), and the pack needs `--extra-only` or it will touch a donor
 *  block and stop being additive.
 */
export function buildCommands({ bundle, plan }) {
  const lod = (bundle.manifest.lod_chain || [])[0];
  const rawName = lod ? `block${lod.block}_P000.ucfx` : 'block<N>_P000.ucfx';
  const CONT = ' \\';
  const lines = [
    `# ADDITIVE reskin of "${bundle.name}" — originals untouched, this is a NEW outfit.`,
    `#`,
    `# new model asset : ${plan.modelName}  ${hex8(plan.modelHash)}`,
    ...plan.items.map((i) =>
      `# new texture     : ${i.texName}  ${hex8(i.texHash)}   (was ${i.originalName || i.originalHash})`),
    ``,
    `# 1. Clone the donor's model container, repointing its material texture references.`,
    `#    NOT inject_parts --repoint: that requires at least one --part, so it cannot`,
    `#    express "same mesh, different textures". repoint_model.py rewrites only the`,
    `#    4-byte hashes inside MTRL plus the trailing CSUM; every geometry byte is copied`,
    `#    verbatim, and it re-verifies the result before writing.`,
    `python repoint_model.py raw/${rawName} ${plan.modelName}.ucfx` + CONT,
  ];
  plan.items.forEach((i, n) => {
    lines.push(`    ${i.originalHash}:${hex8(i.texHash)}` + (n < plan.items.length - 1 ? CONT : ''));
  });
  lines.push(
    ``,
    `# 2. Pack every new asset into a patch WAD. --extra-only means "add blocks, never`,
    `#    touch a donor block" — that flag is what keeps this additive.`,
    `mercs2_smuggler --source-wad "<game>/data/vz.wad" --extra-only` + CONT,
  );
  for (const i of plan.items) {
    lines.push(`    --inject-extra ${hex8(i.texHash)}:27:${i.file}` + CONT);
  }
  lines.push(
    `    --inject-extra ${hex8(plan.modelHash)}:19:${plan.modelName}.ucfx` + CONT,
    `    -o ${plan.modelName}-patch.wad`,
    ``,
    `# 3. Install. Import the patch WAD in the modkit (it merges with your other mods), or`,
    `#    if you have no other patch, drop it in as data/vz-patch.wad.`,
    ``,
    `# 4. Wear it in-game`,
    `#    Player.SetOutfit(Player.GetLocalCharacter(), "${plan.modelName}")`,
  );
  return lines.join('\n');
}

/**
 * The modkit path: a texture-swap mod the modkit packs itself.
 *
 * Its contract is just `{name, image_path}` per swap -- it does the DXT1 encode, the
 * fully-resident container, the WAD assembly, the load order and the merging with other
 * installed mods. So this path emits PNGs plus a definition and stops there.
 *
 * Swaps target a texture by NAME, which is why hash->name recovery is a hard requirement
 * here rather than a nicety: a texture whose name was never recovered cannot be swapped
 * this way, and is reported instead of being silently dropped.
 */
export function buildModkitMod({ bundle, plan, skinName }) {
  const usable = plan.items.filter((i) => i.originalName);
  const unnamed = plan.items.filter((i) => !i.originalName);
  const mod = {
    name: skinName || plan.modelName,
    kind: 'texture-swap',
    target: bundle.name,
    generatedBy: 'mercs2-skinner',
    textures: usable.map((i) => ({
      name: i.originalName,          // engine name — what TextureSwap.name expects
      image_path: `textures/${i.pngFile}`,
      // context, ignored by the packer but useful to a human reading the mod
      hash: i.originalHash,
      size: `${i.texture.width}x${i.texture.height}`,
      role: i.texture.roles.join('+'),
    })),
  };
  return {
    mod,
    json: JSON.stringify(mod, null, 2),
    unnamed,
    blocked: unnamed.length
      ? `${unnamed.length} edited texture(s) have no recovered engine name ` +
        `(${unnamed.map((i) => i.originalHash).join(', ')}) and cannot be swapped by the ` +
        `modkit, which targets textures by name. Use the new-asset export for those.`
      : null,
  };
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
