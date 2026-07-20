// The bundle reader joins manifest + glTF + bin so a texture can be shown with the UV
// layout that actually lands on it. If this is wrong the wireframe lies, which is worse
// than having none.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBundle, sortBundleFiles } from '../src/bundle.js';

const FIX = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export function run(t) {
  if (!existsSync(join(FIX, 'bundle_manifest.json'))) {
    t.skip('bundle reader', 'mercs2_workshop --export-bundle civ_hum_beachfemale_a --out <dir>, then copy manifest.json/model.gltf/model.bin into test/fixtures/');
    return;
  }
  const manifest = JSON.parse(readFileSync(join(FIX, 'bundle_manifest.json'), 'utf8'));
  const gltf = JSON.parse(readFileSync(join(FIX, 'bundle_model.gltf'), 'utf8'));
  const hasBin = existsSync(join(FIX, 'bundle_model.bin'));
  const bin = hasBin
    ? (() => { const b = readFileSync(join(FIX, 'bundle_model.bin')); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); })()
    : new ArrayBuffer(0);

  const b = readBundle({ manifest, gltf, bin });
  t.eq('bundle name', b.name, 'civ_hum_beachfemale_a');
  t.eq('texture count', b.textures.length, 12);
  t.eq('draw-group/primitive count', b.prims.length, 15);

  // Textures sort diffuse-first: that is the one people actually want to paint.
  t.eq('first texture is a diffuse', b.textures[0].roles.includes('diffuse'), true);
  const diffuse = b.textures.filter((x) => x.roles.includes('diffuse'));
  t.eq('four distinct diffuse sheets', diffuse.length, 4);

  // Every texture the manifest lists must be attributable to a role, or the UI will show
  // an unexplained "unused" entry.
  const orphan = b.textures.filter((x) => !x.roles.length);
  t.eq('no texture is left without a role', orphan.length, 0, JSON.stringify(orphan.map((o) => o.hash)));

  const main = b.textures.find((x) => x.hash === '0x8DE46BB7');
  t.ok('the torso sheet is found', !!main);
  t.eq('it is a diffuse', main.roles.join(), 'diffuse');
  t.eq('used by 4 primitives across LOD rungs', main.primitives.length, 4);
  t.eq('finest LOD rung is 0', main.bestLod, 0);

  if (!hasBin) {
    t.skip('UV/geometry extraction', 'copy model.bin to test/fixtures/bundle_model.bin');
    return;
  }
  // UVs: finest LOD only, and every coordinate must be sane.
  const tris = b.uvTriangles('0x8DE46BB7');
  t.ok(`UV triangles extracted (${tris.length})`, tris.length > 0);
  const flat = tris.flat();
  const inRange = flat.filter((v) => v >= -0.01 && v <= 1.01).length;
  t.ok(`${((100 * inRange) / flat.length).toFixed(1)}% of UVs lie in [0,1]`,
    inRange / flat.length > 0.95, 'UVs outside 0..1 mean the overlay will not line up');
  t.ok('only the finest LOD contributes',
    tris.length < main.primitives.length * 2000, 'coarse rungs appear to be included too');

  const geo = b.geometryFor('0x8DE46BB7');
  t.ok('geometry extracted for the preview', !!geo);
  t.eq('positions and UVs agree in vertex count', geo.position.length / 3, geo.uv.length / 2);
  t.eq('normals too', geo.position.length / 3, geo.normal.length / 3);
  t.ok('index buffer is non-empty and in range', geo.index.length > 0 &&
    Math.max(...geo.index) < geo.position.length / 3);
  t.eq('index count is a multiple of 3', geo.index.length % 3, 0);

  // File sorting
  const s = sortBundleFiles([
    { name: 'manifest.json', webkitRelativePath: 'b/manifest.json' },
    { name: 'model.gltf', webkitRelativePath: 'b/model.gltf' },
    { name: 'model.bin', webkitRelativePath: 'b/model.bin' },
    { name: 'tex_0xAB.png', webkitRelativePath: 'b/textures/tex_0xAB.png' },
    { name: 'block1_P000.ucfx', webkitRelativePath: 'b/raw/block1_P000.ucfx' },
  ]);
  t.ok('sorts a bundle folder', !!s.manifest && !!s.gltf && !!s.bin && s.textures.size === 1 && s.raw.size === 1);
}
