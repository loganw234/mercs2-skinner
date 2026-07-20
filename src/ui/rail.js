// A rail: one question on screen at a time, everything after it locked.
//
// The old step 0 put every question, every caveat and both commands on screen at once. It
// was all correct and all present, which is exactly the failure -- a beginner cannot tell
// which sentence applies to them right now, so they read none of them and ask instead.
//
// So: one open step, finished ones collapsed to a single line with a tick, later ones
// visibly locked. A locked step is not hidden -- seeing that three more steps exist is
// reassuring, whereas an empty page is not -- it just cannot be interacted with yet.

import { el } from './dom.js';

export class Rail {
  constructor(root) {
    this.root = root;
    this.steps = [];
    this.open = 0;
  }

  /**
   * @param {string} id
   * @param {string} title      shown in the header, always
   * @param {Function} render   (body, rail) => void. Called each time the step opens.
   * @param {Function} [summary] () => string, the one-line recap once it is done
   */
  add(id, title, render, summary) {
    this.steps.push({ id, title, render, summary, done: false });
    return this;
  }

  /** Drop every step after `id` -- used when an earlier answer changes what follows. */
  truncateAfter(id) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i >= 0) this.steps.length = i + 1;
    return this;
  }

  get(id) { return this.steps.find((s) => s.id === id); }

  /** Mark a step finished and open the next one.
   *
   *  Completing the LAST step leaves `open` past the end, so every step collapses to a
   *  tick and nothing is left sitting open with no action in it -- the rail is finished,
   *  and the work has moved to the panels below. */
  complete(id) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.steps[i].done = true;
    if (this.open === i) this.open = i + 1;
    this.draw();
    if (this.open >= this.steps.length && this.onFinish) this.onFinish();
  }

  /** Re-open a finished step. Everything after it becomes unfinished again, because an
   *  answer here usually invalidates them. */
  reopen(id) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.open = i;
    for (let k = i; k < this.steps.length; k++) this.steps[k].done = false;
    this.draw();
  }

  draw() {
    this.root.innerHTML = '';
    this.steps.forEach((s, i) => {
      const locked = i > this.open;
      const isOpen = i === this.open;
      const wrap = el('div', `step${isOpen ? ' open' : ''}${locked ? ' locked' : ''}${s.done && !isOpen ? ' done' : ''}`);
      wrap.dataset.step = s.id;

      const head = el('button', 'step-head');
      head.type = 'button';
      head.appendChild(el('span', 'step-n', s.done && !isOpen ? '✓' : String(i + 1)));
      head.appendChild(el('span', 'step-t', s.title));
      if (s.done && !isOpen && s.summary) {
        head.appendChild(el('span', 'step-sum', s.summary() || ''));
      }
      if (locked) head.appendChild(el('span', 'step-lock', 'locked'));
      // Only a FINISHED step can be jumped back to. Skipping ahead is the thing this
      // whole design exists to prevent.
      if (s.done && !isOpen) {
        head.addEventListener('click', () => this.reopen(s.id));
        head.classList.add('clickable');
      } else {
        head.disabled = true;
      }
      wrap.appendChild(head);

      if (isOpen) {
        const body = el('div', 'step-body');
        wrap.appendChild(body);
        s.render(body, this);
      }
      this.root.appendChild(wrap);
    });
  }
}

/**
 * A verdict card: what the tool found, and whether it is good enough to continue.
 *
 * Shown after anything the user supplies is inspected -- a dropped folder above all. The
 * point is that "did it work?" is answered on screen, in the place they are looking,
 * instead of being something they have to infer from whether an error appeared.
 */
export function verdict({ ok, title, lines = [], hint }) {
  const box = el('div', `verdict ${ok ? 'ok' : 'bad'}`);
  const h = el('div', 'verdict-h');
  h.appendChild(el('span', 'verdict-i', ok ? '✓' : '✕'));
  h.appendChild(el('span', null, title));
  box.appendChild(h);
  for (const l of lines) {
    const row = el('div', `verdict-row${l.ok === false ? ' bad' : ''}`);
    row.appendChild(el('span', 'verdict-k', l.k));
    row.appendChild(el('span', 'verdict-v', l.v));
    box.appendChild(row);
  }
  if (hint) box.appendChild(el('div', 'verdict-hint', hint));
  return box;
}
