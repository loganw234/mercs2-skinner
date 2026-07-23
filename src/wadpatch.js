// Assemble a drop-in vz-patch.wad from the skinner's encoded UCFX containers, and merge into
// an existing patch. Thin wrapper over the vendored wad-simulator-js packing (src/wadpack) so
// the UI never touches block / ASET framing directly. This is the in-browser equivalent of the
// `mercs2_smuggler --inject-extra HASH:TYPEID:file` the install.bat would have run.

import { makeExtraBlock } from './wadpack/block.js';
import { buildPatchWadMulti, mergePatchWads, readPatchWad } from './wadpack/patch_wad.js';

/**
 * Build a PC FFCS vz-patch.wad from one or more asset blocks.
 *
 * @param {Array<{container:Uint8Array, hash:number, typeId:number, name:string}>} blocks
 *        each an encoded UCFX container + the hash it overrides + its type (27 tex / 19 model).
 * @param {Uint8Array|null} existingWad  when given, merge the new blocks into this patch so the
 *        user's other skins are kept (replace=true → re-packing the same skin is idempotent).
 * @returns {Uint8Array} the vz-patch.wad bytes, ready to download and drop into the game.
 */
export function assembleWadPatch(blocks, existingWad = null) {
  if (!blocks || !blocks.length) throw new Error('No assets to pack.');
  const patchBlocks = blocks.map((b) =>
    makeExtraBlock(b.container, b.hash >>> 0, b.typeId, `blocks\\VZ\\${b.name}.block`));
  return existingWad
    ? mergePatchWads(existingWad, patchBlocks, true)
    : buildPatchWadMulti(patchBlocks);
}

/** Read a patch WAD's block / override counts, for the "merge keeps N skins" guidance.
 *  Throws if the bytes are not a patch WAD (e.g. the base vz.wad, or a random file). */
export function inspectPatch(bytes) {
  const { blocks } = readPatchWad(bytes);
  return { blocks: blocks.length, overrides: blocks.reduce((n, b) => n + b.asetEntries.length, 0) };
}
