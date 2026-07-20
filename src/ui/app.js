// mercs2-skinner UI.
//
// Flow: drop an export bundle -> pick a texture -> see it with its UV layout drawn on top
// -> replace or paint over it -> check the preview -> export a NEW asset pair.

import { readBundle, sortBundleFiles, MISSING_HINT } from '../bundle.js';
import { buildUcfxTexture, isPow2 } from '../texture.js';
import { planExport, buildCommands, buildModkitMod, preflight, hex8, sanitizeAssetName } from '../export.js';
import { setNameSource, nameForHash } from '../names.js';
import { setCatalogue, buildWizard, onDonorPicked } from './wizard.js';
import { initSwap, setSwapVisible } from './swap.js';
import { $, el, wireDrop } from './dom.js';
import { makeZip } from '../zip.js';
import { buildMask, applyShift, previewMask, maskCount, cloneImage, rgbToHsv, hsvToRgb } from '../recolor.js';
import { Preview } from '../preview.js';


const S = {
  bundle: null,
  files: null,
  textures: new Map(),   // hash -> {original: ImageData, edited: ImageData|null, name}
  selected: null,
  showUV: true,
  skinName: '',
};
let preview;

export async function boot() {
  // Bundled build inlines the name list; dev build fetches it. Without it the modkit
  // export is impossible (it targets textures by name) and the UI shows bare hashes.
  setNameSource(window.__SKINNER_NAMES__ || await fetch('./data/asset_names.txt').then((r) => r.text()));

  // Step 0. Baked in so a newcomer never has to know a character name up front.
  setCatalogue(window.__SKINNER_DONORS__
    || await fetch('./data/donors.json').then((r) => r.json()));
  buildWizard($('#wizard'));
  onDonorPicked((c, goal) => {
    S.wizardChar = c;
    S.wizardGoal = goal;
    // Pre-name the skin after the character they picked, so the export section is already
    // sensible before they have typed anything.
    if (!S.skinName || /_custom$/.test(S.skinName)) {
      S.skinName = sanitizeAssetName(c.name + '_custom');
      if ($('#skin-name')) $('#skin-name').value = S.skinName;
    }
    setSwapVisible(goal === 'swap' && !!S.bundle, S.bundle && S.bundle.name);
  });

  initSwap({
    parseFolder,
    getTarget: () => S.bundle,
    getSizes: () => new Map([...S.textures].map(([h, r]) => [h, { width: r.width, height: r.height }])),
    onApply: applyTransfer,
    status,
    fail,
  });

  preview = new Preview($('#preview'));
  if (!preview.ok) $('#preview-note').textContent = 'WebGL unavailable — the 3D preview is disabled.';

  wireDrop($('#drop'), $('#bundle-input'), (files) => load(files).catch(fail));
  $('#show-uv').addEventListener('change', (e) => { S.showUV = e.target.checked; drawTexture(); });
  $('#replace-input').addEventListener('change', (e) => replaceTexture(e.target.files[0]).catch(fail));
  $('#skin-name').addEventListener('input', (e) => { S.skinName = e.target.value; renderExport(); });
  $('#btn-revert').addEventListener('click', () => {
    const t = S.textures.get(S.selected);
    if (t) { t.edited = null; drawTexture(); pushToPreview(); renderExport(); renderList(); }
  });
  $('#btn-ucfx').addEventListener('click', exportUcfx);
  $('#btn-modkit').addEventListener('click', exportModkit);
  $('#btn-png').addEventListener('click', exportPng);
  wireRecolor();
  window.addEventListener('resize', () => preview.draw());
  status('Drop an export-bundle folder to begin.');
}

/** Read a dropped export-bundle folder into a bundle plus its decoded textures.
 *  Shared with the outfit swap, which loads a SECOND bundle exactly the same way. */
async function parseFolder(files) {
  const sorted = sortBundleFiles(files);
  if (!sorted.manifest || !sorted.gltf || !sorted.bin) {
    throw new Error('That is not a complete export bundle.\n' + MISSING_HINT +
      `\n\nFound: ${sorted.manifest ? 'manifest.json ' : ''}${sorted.gltf ? 'model.gltf ' : ''}` +
      `${sorted.bin ? 'model.bin ' : ''}${sorted.textures.size} texture(s).`);
  }
  const manifest = JSON.parse(await sorted.manifest.text());
  const gltf = JSON.parse(await sorted.gltf.text());
  const bin = await sorted.bin.arrayBuffer();
  const bundle = readBundle({ manifest, gltf, bin });

  const images = new Map();
  for (const tex of bundle.textures) {
    const base = (tex.file || '').split('/').pop().toLowerCase();
    const f = sorted.textures.get(base);
    if (!f) continue;
    const img = await createImageBitmap(f);
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
    images.set(tex.hash, cv.getContext('2d').getImageData(0, 0, img.width, img.height));
  }
  return { bundle, images, sorted };
}

async function load(files) {
  status('reading bundle…');
  const { bundle, images, sorted } = await parseFolder(files);
  S.bundle = bundle;
  S.files = sorted;
  S.textures.clear();
  for (const [hash, img] of images) {
    S.textures.set(hash, {
      original: img, edited: null, width: img.width, height: img.height,
    });
  }
  S.skinName = sanitizeAssetName(S.bundle.name + '_custom');
  $('#skin-name').value = S.skinName;
  $('#bundle-name').textContent =
    `${S.bundle.name} — ${S.bundle.textures.length} textures, ${S.bundle.prims.length} draw groups` +
    (S.bundle.skinned ? ', skinned' : '');
  $('#step-edit').hidden = false;
  $('#step-export').hidden = false;
  setSwapVisible(S.wizardGoal === 'swap', S.bundle.name);
  select(S.bundle.textures[0]?.hash);
  renderList();
  status('');
}

/** Adopt the re-mapped sheets as edits, so the existing export machinery — preflight,
 *  modkit mod, new-asset kit, 3D preview — applies unchanged. */
function applyTransfer(results) {
  let n = 0;
  for (const [hash, r] of results) {
    const rec = S.textures.get(hash);
    if (!rec) continue;
    rec.edited = r.image;
    n++;
  }
  if (!n) return fail(new Error('The swap produced no sheets that match this bundle.'));
  select(S.bundle.textures.find((t) => results.has(t.hash))?.hash || S.selected);
  drawTexture(); pushToPreview(); renderExport(); renderList();
  note(`${n} sheet(s) replaced with the re-mapped outfit. Revert any one of them from step 2.`);
}

function renderList() {
  const wrap = $('#tex-list');
  wrap.innerHTML = '';
  for (const t of S.bundle.textures) {
    const rec = S.textures.get(t.hash);
    const row = el('button', 'tex-row' + (t.hash === S.selected ? ' sel' : ''));
    row.appendChild(el('span', 'role ' + (t.roles[0] || 'other'), t.roles.join('+') || 'unused'));
    const d = t.described;
    row.appendChild(el('span', 'thash', d && d.part ? d.part : (t.name || t.hash)));
    row.appendChild(el('span', 'tdim', `${t.width}×${t.height}`));
    row.appendChild(el('span', 'ttri', t.triangles ? `${t.triangles} tris` : '—'));
    if (rec && rec.edited) row.appendChild(el('span', 'badge edited', 'edited'));
    if (!rec) row.appendChild(el('span', 'badge missing', 'no png'));
    row.addEventListener('click', () => { select(t.hash); renderList(); });
    wrap.appendChild(row);
  }
}

function select(hash) {
  if (!hash) return;
  S.selected = hash;
  const t = S.bundle.textures.find((x) => x.hash === hash);
  const rec = S.textures.get(hash);
  $('#tex-title').textContent = (t.name || hash) + ` · ${t.roles.join('+') || 'unused'} · ${t.width}×${t.height}`;
  $('#tex-sub').textContent = (t.name ? `${hash} · ` : `${hash} · name not recovered · `) +
    (t.triangles
      ? `${t.triangles} triangles across ${t.primitives.length} draw group(s), finest LOD ${t.bestLod}`
      : 'not referenced by any draw group in this bundle');
  $('#btn-revert').disabled = !(rec && rec.edited);
  drawTexture();
  pushToPreview();
  renderExport();
}

function currentImage() {
  const rec = S.textures.get(S.selected);
  return rec ? (rec.edited || rec.original) : null;
}

function drawTexture() { drawImage(currentImage()); }

/** Paint an image plus the UV overlay. Split out from drawTexture so the live recolour
 *  preview goes through exactly the same path instead of a second, divergent one. */
function drawImage(img) {
  const cv = $('#tex-canvas');
  if (!img) { cv.width = cv.height = 1; return; }
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.putImageData(img, 0, 0);
  if (!S.showUV) return;
  // UV wireframe. Without this a texture sheet is unpaintable -- you cannot tell a
  // sleeve from a jaw.
  const tris = S.bundle.uvTriangles(S.selected);
  ctx.save();
  ctx.lineWidth = Math.max(0.5, img.width / 1024);
  ctx.strokeStyle = 'rgba(255,64,160,0.85)';
  ctx.beginPath();
  for (const [u1, v1, u2, v2, u3, v3] of tris) {
    const x1 = u1 * img.width, y1 = v1 * img.height;
    const x2 = u2 * img.width, y2 = v2 * img.height;
    const x3 = u3 * img.width, y3 = v3 * img.height;
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
  $('#uv-count').textContent = `${tris.length} UV triangles`;
}

function pushToPreview() {
  if (!preview.ok || !S.bundle) return;
  const geo = S.bundle.geometryFor(S.selected);
  preview.setGeometry(geo);
  const img = currentImage();
  if (img) preview.setTexture(img);
  $('#preview-note').textContent = geo
    ? 'drag to orbit · scroll to zoom'
    : 'this texture is not on any drawing group, nothing to preview';
}

async function replaceTexture(file) {
  if (!file || !S.selected) return;
  const img = await createImageBitmap(file);
  const rec = S.textures.get(S.selected);
  const cv = document.createElement('canvas');
  // Keep the ORIGINAL sheet size by default: the texture pool has a hard cell cap and
  // upscaling costs budget for no visible gain.
  cv.width = rec.width; cv.height = rec.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, rec.width, rec.height);
  rec.edited = ctx.getImageData(0, 0, rec.width, rec.height);
  if (img.width !== rec.width || img.height !== rec.height) {
    note(`Resized ${img.width}×${img.height} → ${rec.width}×${rec.height} to match the original sheet.`);
  } else note('');
  drawTexture(); pushToPreview(); renderExport(); renderList();
  $('#btn-revert').disabled = false;
}

/** Every texture the user has actually edited -- both exports work on the whole set,
 *  because a uniform spans several sheets and shipping one leaves a half-reskinned
 *  character. */
function editedTextures() {
  const out = [];
  for (const t of S.bundle.textures) {
    const rec = S.textures.get(t.hash);
    if (rec && rec.edited) out.push({ texture: t, name: t.name, rec });
  }
  return out;
}

function renderExport() {
  if (!S.bundle) return;
  const edits = editedTextures();
  S.edits = edits;
  const plan = planExport({ bundle: S.bundle, edits, skinName: S.skinName });
  S.plan = plan;
  const modkit = buildModkitMod({ bundle: S.bundle, plan, skinName: S.skinName });
  S.modkit = modkit;

  $('#edit-count').textContent = edits.length
    ? `${edits.length} texture(s) edited: ${edits.map((e) => (e.texture.described && e.texture.described.part) || e.name || e.texture.hash).join(', ')}`
    : 'No textures edited yet — replace one above.';

  // Preflight across every edited sheet, not just the selected one.
  const cw = $('#checks');
  cw.innerHTML = '';
  for (const e of edits) {
    const item = plan.items.find((i) => i.originalHash === e.texture.hash);
    const clash = item ? nameForHash(item.texHash) : null;
    const collide = item ? { hit: clash, name: item.texName } : null;
    for (const c of preflight({ width: e.rec.width, height: e.rec.height, texture: e.texture, name: S.skinName, collide })) {
      if (c.ok && c.id !== 'name') continue;      // only surface problems, plus the name
      const chip = el('span', `chip ${c.ok ? 'ok' : 'bad'}`,
        `${(e.texture.described && e.texture.described.part) || e.texture.hash} — ${c.title}: ${c.text}`);
      chip.title = c.detail;
      cw.appendChild(chip);
    }
  }
  if (!cw.children.length && edits.length) cw.appendChild(el('span', 'chip ok', 'all preflight checks pass'));

  $('#incomplete-warn').hidden = !plan.incompleteWarning || !edits.length;
  $('#incomplete-warn').textContent = plan.incompleteWarning || '';
  $('#modkit-blocked').hidden = !modkit.blocked;
  $('#modkit-blocked').textContent = modkit.blocked || '';

  $('#hashes').textContent = edits.length
    ? `new model "${plan.modelName}" ${hex8(plan.modelHash)}  ·  ` +
      plan.items.map((i) => `${i.texName} ${hex8(i.texHash)}`).join('  ·  ')
    : '';
  $('#cmd').textContent = edits.length ? buildCommands({ bundle: S.bundle, plan }) : '';
  $('#modkit-json').textContent = modkit.mod.textures.length ? modkit.json : '';
  $('#btn-ucfx').disabled = !edits.length;
  $('#btn-modkit').disabled = !modkit.mod.textures.length;
}

/** Path A — modkit: PNGs + a definition. The modkit does the encode, the container, the
 *  WAD assembly and the merge with other installed mods. */
async function exportModkit() {
  const zipFiles = [{ name: 'mod.json', data: new TextEncoder().encode(S.modkit.json) }];
  for (const item of S.plan.items) {
    if (!item.originalName) continue;             // unnamed cannot be swapped by name
    const rec = S.textures.get(item.originalHash);
    const cv = document.createElement('canvas');
    cv.width = rec.width; cv.height = rec.height;
    cv.getContext('2d').putImageData(rec.edited || rec.original, 0, 0);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    zipFiles.push({ name: `textures/${item.pngFile}`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  download(`${S.plan.modelName}-modkit.zip`, makeZip(zipFiles));
}

/** Path B — new asset: encode every edited sheet to a fully-resident UCFX container. */
function exportUcfx() {
  const bad = S.plan.items.filter((i) => {
    const r = S.textures.get(i.originalHash);
    return !isPow2(r.width) || !isPow2(r.height);
  });
  if (bad.length) return fail(new Error('Every texture must be power-of-two; these are not: ' +
    bad.map((i) => `${i.originalName || i.originalHash}`).join(', ')));

  status(`encoding ${S.plan.items.length} texture(s) to DXT1…`);
  setTimeout(() => {
    try {
      const files = [];
      for (const item of S.plan.items) {
        const rec = S.textures.get(item.originalHash);
        const img = rec.edited || rec.original;
        const rgb = new Float32Array(img.width * img.height * 3);
        for (let i = 0, n = img.width * img.height; i < n; i++) {
          rgb[i * 3] = img.data[i * 4];
          rgb[i * 3 + 1] = img.data[i * 4 + 1];
          rgb[i * 3 + 2] = img.data[i * 4 + 2];
        }
        files.push({
          name: item.file,
          data: buildUcfxTexture({ width: img.width, height: img.height, rgb, name: item.texName }),
        });
      }
      files.push({ name: 'build.sh', data: new TextEncoder().encode(buildCommands({ bundle: S.bundle, plan: S.plan })) });
      download(`${S.plan.modelName}-assets.zip`, makeZip(files));
      status('');
    } catch (e) { fail(e); }
  }, 16);
}

function exportPng() {
  $('#tex-canvas').toBlob((b) => {
    const a = el('a');
    a.href = URL.createObjectURL(b);
    a.download = `${S.selected}${S.showUV ? '_uv_template' : ''}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

function download(name, bytes) {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const status = (m) => { $('#status').textContent = m; $('#status').hidden = !m; $('#error').hidden = true; };
const note = (m) => { $('#note').textContent = m; $('#note').hidden = !m; };
function fail(e) {
  console.error(e);
  $('#status').hidden = true;
  $('#error').hidden = false;
  $('#error').textContent = e.message || String(e);
}

// ---------------------------------------------------------------- recolour
// Pick a colour on the sheet, shift everything like it. The most common edit anyone will
// make, and it should not require leaving the tool.

const RC = { picking: false, target: null, mask: null, base: null };

function wireRecolor() {
  $('#btn-pick').addEventListener('click', () => {
    RC.picking = !RC.picking;
    $('#tex-canvas').classList.toggle('picking', RC.picking);
    $('#btn-pick').textContent = RC.picking ? '⏳ click the sheet…' : '🎨 Pick a colour…';
  });
  $('#tex-canvas').addEventListener('click', (e) => {
    if (!RC.picking) return;
    const cv = $('#tex-canvas');
    const r = cv.getBoundingClientRect();
    // The canvas is displayed scaled to fit, so map the click back to texel space.
    const x = Math.floor(((e.clientX - r.left) / r.width) * cv.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * cv.height);
    const img = currentImage();
    if (!img || x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 4;
    RC.target = [img.data[i], img.data[i + 1], img.data[i + 2]];
    RC.base = cloneImage(img);
    RC.picking = false;
    $('#tex-canvas').classList.remove('picking');
    $('#btn-pick').textContent = '🎨 Pick another…';
    $('#rc-swatch').hidden = false;
    $('#rc-swatch').style.background = `rgb(${RC.target.join(',')})`;
    $('#rc-controls').hidden = false;
    recomputeMask();
  });
  for (const id of ['rc-hue', 'rc-sat', 'rc-val']) {
    $('#' + id).addEventListener('input', renderRecolor);
  }
  $('#rc-tol').addEventListener('input', recomputeMask);
  $('#rc-showsel').addEventListener('change', renderRecolor);
  $('#rc-apply').addEventListener('click', applyRecolor);
  $('#rc-cancel').addEventListener('click', cancelRecolor);
}

function recomputeMask() {
  if (!RC.base || !RC.target) return;
  const tol = Number($('#rc-tol').value) / 100;
  $('#rc-tol-v').textContent = tol.toFixed(2);
  RC.mask = buildMask(RC.base, RC.target, { tolerance: tol });
  const n = maskCount(RC.mask);
  const pct = (100 * n) / (RC.base.width * RC.base.height);
  $('#rc-count').textContent = `${n.toLocaleString()} px selected (${pct.toFixed(1)}%)`;
  renderRecolor();
}

/** Live preview straight onto the canvas and the 3D model. */
function renderRecolor() {
  if (!RC.base || !RC.mask) return;
  const hue = Number($('#rc-hue').value);
  const sat = Number($('#rc-sat').value) / 100;
  const val = Number($('#rc-val').value) / 100;
  $('#rc-hue-v').textContent = `${hue}°`;
  $('#rc-sat-v').textContent = `${Math.round(sat * 100)}%`;
  $('#rc-val-v').textContent = `${Math.round(val * 100)}%`;
  const shifted = applyShift(RC.base, RC.mask, { hue, sat, val });
  RC.preview = shifted;
  // The 3D view always shows the real result; only the flat sheet dims the unselected
  // pixels, so you can judge the selection and the colour at the same time.
  drawImage($('#rc-showsel').checked ? previewMask(shifted, RC.mask) : shifted);
  if (preview.ok) preview.setTexture(shifted);
}

function applyRecolor() {
  if (!RC.preview) return cancelRecolor();
  const rec = S.textures.get(S.selected);
  rec.edited = RC.preview;
  RC.base = cloneImage(RC.preview);          // stack further edits on the result

  // Carry the picked colour through the same shift. Without this the target still names
  // the ORIGINAL colour, which no longer exists in the image, so the selection empties to
  // zero and the sliders stop doing anything -- with no visible reason why.
  const [th, ts, tv] = rgbToHsv(RC.target[0], RC.target[1], RC.target[2]);
  RC.target = hsvToRgb(
    th + Number($('#rc-hue').value) / 360,
    Math.min(1, ts * (Number($('#rc-sat').value) / 100)),
    Math.min(1, tv * (Number($('#rc-val').value) / 100)));
  $('#rc-swatch').style.background = `rgb(${RC.target.join(',')})`;

  $('#rc-hue').value = 0; $('#rc-sat').value = 100; $('#rc-val').value = 100;
  recomputeMask();
  drawTexture(); pushToPreview(); renderExport(); renderList();
  $('#btn-revert').disabled = false;
  note('Recolour applied. Pick again to adjust another colour, or export.');
}

function cancelRecolor() {
  RC.target = null; RC.mask = null; RC.base = null; RC.preview = null;
  RC.picking = false;
  $('#tex-canvas').classList.remove('picking');
  $('#btn-pick').textContent = '🎨 Pick a colour…';
  $('#rc-swatch').hidden = true;
  $('#rc-controls').hidden = true;
  $('#rc-count').textContent = '';
  drawTexture(); pushToPreview();
  note('');
}
