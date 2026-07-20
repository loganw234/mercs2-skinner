// The character-picker quality tiers.
//
// These decide which options are shown as good, workable or costly, and they are ordered by
// rank, so getting them wrong silently steers people toward the wrong characters. The
// subtle part is that the scale is NOT fixed: the LOD penalty only applies when a copy is
// actually made.

import { tier } from '../src/ui/wizard.js';

const ch = (blocks, own) => ({
  name: 'x', blocks,
  sheets: own ? [{ part: 'ub' }, { part: 'lb' }] : [{ part: 'head' }],
});

export function run(t) {
  const CLONING = true, IN_PLACE = false;

  // --- cloning: all three tiers are live
  t.eq('single block + own textures is the best pick',
    tier(ch(1, true), CLONING).cls, 'opt-good');
  t.eq('single block + shared textures is the middle tier',
    tier(ch(1, false), CLONING).cls, 'opt-ok');
  t.eq('two blocks is the costly tier',
    tier(ch(2, true), CLONING).cls, 'opt-bad');
  t.eq('two blocks is costly even with its own textures',
    tier(ch(2, false), CLONING).cls, 'opt-bad');

  // --- ranks must sort best-first, since the picker orders on them
  t.ok('ranks order good < ok < bad',
    tier(ch(1, true), CLONING).rank < tier(ch(1, false), CLONING).rank
    && tier(ch(1, false), CLONING).rank < tier(ch(2, true), CLONING).rank);

  // --- ★ nothing is cloned when repainting in place, or when reading a donor's artwork,
  // so the LOD penalty must NOT apply. Marking these red would push people off choices
  // that are completely correct for what they are doing.
  t.eq('a two-block character is NOT penalised when nothing is copied',
    tier(ch(2, true), IN_PLACE).cls, 'opt-good');
  t.eq('in-place still distinguishes shared textures',
    tier(ch(2, false), IN_PLACE).cls, 'opt-ok');
  t.ok('no in-place tier is ever the costly one',
    [ch(1, true), ch(1, false), ch(2, true), ch(2, false)]
      .every((c) => tier(c, IN_PLACE).cls !== 'opt-bad'));

  // --- the wording has to stand alone, because colour is not a carrier
  for (const [c, cloning] of [[ch(1, true), CLONING], [ch(1, false), CLONING],
    [ch(2, true), CLONING], [ch(1, true), IN_PLACE], [ch(2, false), IN_PLACE]]) {
    const tg = tier(c, cloning).tag;
    t.ok(`tier tag is non-empty and jargon-free: "${tg}"`,
      !!tg && tg.length > 3 && !/block|ASET|LOD/i.test(tg));
  }

  // --- a character with no sheets at all must still tier, not throw
  t.eq('missing sheets array does not throw', tier({ name: 'y', blocks: 1 }, CLONING).cls, 'opt-ok');

  t.eq('lower-body-only counts as owning textures', tier(
    { name: 'z', blocks: 1, sheets: [{ part: 'lb' }] }, CLONING).cls, 'opt-good');
  t.eq('head-and-hair only does not count as owning body textures', tier(
    { name: 'z', blocks: 1, sheets: [{ part: 'head' }, { part: 'hair' }] }, CLONING).cls, 'opt-ok');
}
