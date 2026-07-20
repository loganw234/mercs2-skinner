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
