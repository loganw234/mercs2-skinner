// Build dist/mercs2-skinner.html -- one self-contained file users can double-click.
//
//   node tools/bundle.js
//
// ES modules cannot be loaded from file:// (CORS blocks the sub-requests), and neither
// can fetch(), so the module graph is concatenated and the skeleton data is inlined as a
// global. The output stays an INLINE `<script type="module">`, which file:// does allow --
// only external module fetches are blocked.
//
// This is a naive concatenating bundler: it strips `import`/`export` keywords and relies
// on top-level names being unique across modules. That assumption is CHECKED below and
// the build fails loudly rather than emitting a file where one module silently shadows
// another's function.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_RE = /^\s*import\s+[\s\S]*?\s+from\s*['"](\.[^'"]+)['"]\s*;?\s*$/;
const DECL_RE = /^(?:export\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/;

const seen = new Map();      // abs path -> {code, deps}
const order = [];

function load(absPath) {
  if (seen.has(absPath)) return;
  seen.set(absPath, true);
  const src = readFileSync(absPath, 'utf8');
  const lines = src.split(/\r?\n/);
  const kept = [];
  const deps = [];
  let pending = null;
  for (const line of lines) {
    const probe = pending === null ? line : pending + '\n' + line;
    if (/^\s*import\b/.test(probe)) {
      const m = probe.match(IMPORT_RE);
      if (m) { deps.push(resolve(dirname(absPath), m[1])); pending = null; continue; }
      // multi-line import: keep accumulating rather than emitting a broken fragment
      if (!/\bfrom\b/.test(probe)) { pending = probe; continue; }
      throw new Error(`${absPath}: cannot parse import:\n${probe}`);
    }
    pending = null;
    kept.push(line.replace(/^(\s*)export\s+(?=(?:const|let|var|function|class)\b)/, '$1'));
  }
  // A bare `export { a, b };` re-export has no runtime effect once concatenated.
  const code = kept.join('\n').replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  for (const d of deps) load(d);
  order.push({ path: absPath, code });
}

// ---- entry ----
const entry = resolve(ROOT, 'src/ui/app.js');
load(entry);

// ---- collision check ----
const owner = new Map();
const collisions = [];
for (const mod of order) {
  for (const line of mod.code.split('\n')) {
    if (/^\s/.test(line)) continue;                 // top level only
    const m = line.match(DECL_RE);
    if (!m) continue;
    const name = m[1];
    if (owner.has(name) && owner.get(name) !== mod.path) {
      collisions.push(`${name}: ${relative(ROOT, owner.get(name))} and ${relative(ROOT, mod.path)}`);
    } else owner.set(name, mod.path);
  }
}
if (collisions.length) {
  console.error('BUNDLE ABORTED -- duplicate top-level names would shadow each other:\n  ' +
    collisions.join('\n  ') + '\n\nRename one of each pair, or teach this bundler real scoping.');
  process.exit(1);
}

// ---- assemble ----
const body = order.map((m) => `// ===== ${relative(ROOT, m.path).replace(/\\/g, '/')} =====\n${m.code}`).join('\n\n');

const names = readFileSync(resolve(ROOT, 'data/asset_names.txt'), 'utf8');
let html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const scriptRe = /<script type="module">[\s\S]*?<\/script>/;
if (!scriptRe.test(html)) throw new Error('index.html: no <script type="module"> entry point found');
html = html.replace(scriptRe,
  // The recovered asset-name list is the one thing that must ship inlined: fetch() cannot
  // work from file://, and without names the modkit export is impossible (its swap
  // contract targets a texture BY NAME) and the UI would show bare hashes.
  '<script type="module">\n' +
  `window.__SKINNER_NAMES__ = ${JSON.stringify(names)};\n\n` +
  body + '\n\n' +
  'boot().catch((e) => {\n' +
  "  document.getElementById('error').hidden = false;\n" +
  "  document.getElementById('error').textContent = e.message || String(e);\n" +
  '});\n' +
  '</script>');

// Guard the one thing that silently breaks a file:// build. Comments are stripped first,
// or the comment explaining why import.meta is avoided trips the check itself.
const codeOnly = html
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
if (/import\.meta/.test(codeOnly)) {
  throw new Error('bundle still contains import.meta -- it would throw in the inline script');
}
// Any fetch() of a sibling file fails under file://. The asset-name list is the only such
// dependency, and it must have been inlined as a global above.
if (/fetch\(['"]\.\//.test(codeOnly) && !/__SKINNER_NAMES__/.test(codeOnly)) {
  throw new Error('bundle fetches a local file but no inlined data global was emitted');
}

mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
const out = resolve(ROOT, 'dist/mercs2-skinner.html');
writeFileSync(out, html);
console.log(`bundled ${order.length} modules + ${(names.length/1024).toFixed(0)} KB of asset names -> dist/mercs2-skinner.html ` +
  `(${(html.length / 1024).toFixed(0)} KB)`);
console.log('  order: ' + order.map((m) => relative(ROOT, m.path).replace(/\\/g, '/')).join(' -> '));
