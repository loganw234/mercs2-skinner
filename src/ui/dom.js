// Shared DOM helpers.
//
// These lived in app.js and were copied into wizard.js, which the bundler's duplicate-name
// check caught before it could emit a file where one module's `$` silently shadowed the
// other's. One home instead.

export const $ = (s) => document.querySelector(s);

export const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

/** Files from a folder DROP. Directories arrive as entries rather than files, so they have
 *  to be walked; without this, dropping a folder yields nothing at all. Shared because the
 *  outfit swap needs a second drop zone with identical behaviour. */
export async function filesFromDrop(dt) {
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

/** Wire a drop zone + its file input to one handler. */
export function wireDrop(zone, input, handler) {
  input.addEventListener('change', (e) => handler([...e.target.files]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    handler(await filesFromDrop(e.dataTransfer));
  });
}
