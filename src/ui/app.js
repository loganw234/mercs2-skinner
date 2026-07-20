// mercs2-skinner UI.
//
// Flow: drop an export bundle -> pick a texture -> see it with its UV layout drawn on top
// -> replace or paint over it -> check the preview -> export a NEW asset pair.

import { readBundle, sortBundleFiles, MISSING_HINT } from '../bundle.js';
import { buildUcfxTexture, isPow2 } from '../texture.js';
import { planExport, buildCommands, preflight, pandemicHashM2, hex8, sanitizeAssetName } from '../export.js';
import { Preview } from '../preview.js';

const $ = (s) => document.querySelector(s);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };

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
  preview = new Preview($('#preview'));
  if (!preview.ok) $('#preview-note').textContent = 'WebGL unavailable — the 3D preview is disabled.';

  const input = $('#bundle-input');
  input.addEventListener('change', (e) => load([...e.target.files]).catch(fail));
  $('#drop').addEventListener('dragover', (e) => { e.preventDefault(); $('#drop').classList.add('over'); });
  $('#drop').addEventListener('dragleave', () => $('#drop').classList.remove('over'));
  $('#drop').addEventListener('drop', async (e) => {
    e.preventDefault(); $('#drop').classList.remove('over');
    const files = await filesFromDrop(e.dataTransfer);
    load(files).catch(fail);
  });
  $('#show-uv').addEventListener('change', (e) => { S.showUV = e.target.checked; drawTexture(); });
  $('#replace-input').addEventListener('change', (e) => replaceTexture(e.target.files[0]).catch(fail));
  $('#skin-name').addEventListener('input', (e) => { S.skinName = e.target.value; renderExport(); });
  $('#btn-revert').addEventListener('click', () => {
    const t = S.textures.get(S.selected);
    if (t) { t.edited = null; drawTexture(); pushToPreview(); renderExport(); renderList(); }
  });
  $('#btn-ucfx').addEventListener('click', exportUcfx);
  $('#btn-png').addEventListener('click', exportPng);
  window.addEventListener('resize', () => preview.draw());
  status('Drop an export-bundle folder to begin.');
}

/** Directory drops arrive as entries, not files. */
async function filesFromDrop(dt) {
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name, configurable: true });
      out.push(f);
    } else if (entry.isDirectory) {
      const rd = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => rd.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, path + entry.name + '/');
      }
    }
  };
  const roots = [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (roots.length) { for (const r of roots) await walk(r, ''); return out; }
  return [...dt.files];
}

async function load(files) {
  status('reading bundle…');
  const sorted = sortBundleFiles(files);
  if (!sorted.manifest || !sorted.gltf || !sorted.bin) {
    throw new Error('That is not a complete export bundle.\n' + MISSING_HINT +
      `\n\nFound: ${sorted.manifest ? 'manifest.json ' : ''}${sorted.gltf ? 'model.gltf ' : ''}` +
      `${sorted.bin ? 'model.bin ' : ''}${sorted.textures.size} texture(s).`);
  }
  const manifest = JSON.parse(await sorted.manifest.text());
  const gltf = JSON.parse(await sorted.gltf.text());
  const bin = await sorted.bin.arrayBuffer();
  S.bundle = readBundle({ manifest, gltf, bin });
  S.files = sorted;
  S.textures.clear();

  for (const tex of S.bundle.textures) {
    const base = (tex.file || '').split('/').pop().toLowerCase();
    const f = sorted.textures.get(base);
    if (!f) continue;
    const img = await createImageBitmap(f);
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
    S.textures.set(tex.hash, {
      original: cv.getContext('2d').getImageData(0, 0, img.width, img.height),
      edited: null, width: img.width, height: img.height,
    });
  }
  S.skinName = sanitizeAssetName(S.bundle.name + '_custom');
  $('#skin-name').value = S.skinName;
  $('#bundle-name').textContent =
    `${S.bundle.name} — ${S.bundle.textures.length} textures, ${S.bundle.prims.length} draw groups` +
    (S.bundle.skinned ? ', skinned' : '');
  $('#step-edit').hidden = false;
  $('#step-export').hidden = false;
  select(S.bundle.textures[0]?.hash);
  renderList();
  status('');
}

function renderList() {
  const wrap = $('#tex-list');
  wrap.innerHTML = '';
  for (const t of S.bundle.textures) {
    const rec = S.textures.get(t.hash);
    const row = el('button', 'tex-row' + (t.hash === S.selected ? ' sel' : ''));
    row.appendChild(el('span', 'role ' + (t.roles[0] || 'other'), t.roles.join('+') || 'unused'));
    row.appendChild(el('span', 'thash', t.hash));
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
  $('#tex-title').textContent = `${hash} · ${t.roles.join('+') || 'unused'} · ${t.width}×${t.height}`;
  $('#tex-sub').textContent = t.triangles
    ? `${t.triangles} triangles across ${t.primitives.length} draw group(s), finest LOD ${t.bestLod}`
    : 'not referenced by any draw group in this bundle';
  $('#btn-revert').disabled = !(rec && rec.edited);
  drawTexture();
  pushToPreview();
  renderExport();
}

function currentImage() {
  const rec = S.textures.get(S.selected);
  return rec ? (rec.edited || rec.original) : null;
}

function drawTexture() {
  const cv = $('#tex-canvas');
  const img = currentImage();
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

function renderExport() {
  if (!S.bundle || !S.selected) return;
  const tex = S.bundle.textures.find((t) => t.hash === S.selected);
  const rec = S.textures.get(S.selected);
  if (!tex || !rec) return;
  const plan = planExport({ bundle: S.bundle, texture: tex, skinName: S.skinName });
  S.plan = plan;

  const checks = preflight({ width: rec.width, height: rec.height, texture: tex, name: S.skinName });
  const cw = $('#checks');
  cw.innerHTML = '';
  for (const c of checks) {
    const chip = el('span', `chip ${c.ok ? 'ok' : 'bad'}`, `${c.title}: ${c.text}`);
    chip.title = c.detail;
    cw.appendChild(chip);
  }
  $('#hashes').textContent =
    `texture "${plan.texName}" ${hex8(plan.texHash)}   ·   model "${plan.modelName}" ${hex8(plan.modelHash)}`;
  $('#shared-warn').hidden = !plan.sharedWarning;
  $('#shared-warn').textContent = plan.sharedWarning || '';
  $('#cmd').textContent = buildCommands({ bundle: S.bundle, texture: tex, plan });
  $('#btn-ucfx').disabled = !rec.edited;
  $('#export-hint').textContent = rec.edited ? '' : 'Replace the texture first — nothing to export yet.';
}

function exportUcfx() {
  const rec = S.textures.get(S.selected);
  const img = rec.edited || rec.original;
  if (!isPow2(img.width) || !isPow2(img.height)) {
    return fail(new Error(`Texture must be power-of-two; this is ${img.width}×${img.height}.`));
  }
  status('encoding DXT1…');
  setTimeout(() => {
    try {
      const rgb = new Float32Array(img.width * img.height * 3);
      for (let i = 0, n = img.width * img.height; i < n; i++) {
        rgb[i * 3] = img.data[i * 4];
        rgb[i * 3 + 1] = img.data[i * 4 + 1];
        rgb[i * 3 + 2] = img.data[i * 4 + 2];
      }
      const bytes = buildUcfxTexture({ width: img.width, height: img.height, rgb, name: S.plan.texName });
      download(S.plan.textureFile, bytes);
      status('');
    } catch (e) { fail(e); }
  }, 16);
}

/** Export the sheet exactly as displayed -- including the UV wireframe when it is on,
 *  because that overlay IS the template people want to open in an image editor. */
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
