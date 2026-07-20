// Zero-dependency test runner.  `npm test`  /  `node test/run.js [filter]`

const filter = process.argv[2];
let pass = 0, fail = 0, skipped = 0;
const failures = [];
const skips = [];

const fmt = (v) => {
  const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  return s.length > 220 ? s.slice(0, 220) + `... (${s.length} chars)` : s;
};

const t = {
  ok(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  [32mPASS[0m ${name}`); }
    else {
      fail++; failures.push(name);
      console.log(`  [31mFAIL[0m ${name}${detail ? '\n        ' + detail : ''}`);
    }
  },
  eq(name, got, want) {
    this.ok(name, Object.is(got, want) || got === want, `got ${fmt(got)}\n        want ${fmt(want)}`);
  },
  /** Numeric compare with tolerance -- for values crossing a float32 or lstsq boundary. */
  near(name, got, want, tol) {
    const d = Math.abs(got - want);
    this.ok(name, d <= tol, `got ${got}, want ${want} (|d|=${d.toExponential(2)} > tol ${tol})`);
  },
  deepEq(name, got, want) {
    const a = JSON.stringify(got), b = JSON.stringify(want);
    if (a === b) { this.ok(name, true); return; }
    // Show the FIRST divergence rather than two giant blobs.
    let detail = `got  ${fmt(got)}\n        want ${fmt(want)}`;
    if (got && want && typeof got === 'object' && typeof want === 'object') {
      const ka = Object.keys(got), kb = Object.keys(want);
      const onlyA = ka.filter((k) => !(k in want)).slice(0, 6);
      const onlyB = kb.filter((k) => !(k in got)).slice(0, 6);
      const diff = ka.filter((k) => k in want && JSON.stringify(got[k]) !== JSON.stringify(want[k])).slice(0, 6);
      detail = `${ka.length} keys vs ${kb.length}` +
        (onlyA.length ? `\n        only in got:  ${onlyA.join(', ')}` : '') +
        (onlyB.length ? `\n        only in want: ${onlyB.join(', ')}` : '') +
        (diff.length ? `\n        differing:    ` + diff.map((k) => `${k}: ${fmt(got[k])} != ${fmt(want[k])}`).join('\n                      ') : '');
    }
    this.ok(name, false, detail);
  },
  throws(name, fn, re) {
    try { fn(); this.ok(name, false, 'expected a throw, got none'); }
    catch (e) { this.ok(name, !re || re.test(e.message), `message ${fmt(e.message)} !~ ${re}`); }
  },
  info(msg) { console.log(`       [2m${msg}[0m`); },
  /** Fixture absent -- announce loudly with a regeneration hint. NOT counted as a pass. */
  skip(name, hint) {
    skipped++; skips.push(name);
    console.log(`  [33mSKIP[0m ${name}${hint ? `\n        regenerate: ${hint}` : ''}`);
  },
};

const SUITES = ['texture.test.js', 'export.test.js', 'bundle.test.js', 'recolor.test.js',
  'transfer.test.js', 'wizard.test.js', 'repoint.test.js'];

for (const s of SUITES) {
  if (filter && !s.includes(filter)) continue;
  console.log(`\n[1m${s}[0m`);
  try {
    const mod = await import(`./${s}`);
    await mod.run(t);
  } catch (e) {
    fail++; failures.push(`${s} (suite threw)`);
    console.log(`  [31mFAIL[0m suite threw: ${e.stack}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`);
if (skipped) console.log('skipped (fixtures not present):\n  - ' + skips.join('\n  - '));
if (fail) { console.log('failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
