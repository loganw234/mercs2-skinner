// Little human figures that show what a choice actually does.
//
// "Whose BODY are you dressing?" and "Whose clothes?" are the two questions people get
// wrong, and no amount of prose fixes it -- the words are already unambiguous and they
// still get skipped. A picture of a person with the relevant half lit up is read before
// the sentence is, and it is read by someone who is not going to read the sentence.
//
// Everything here is inline SVG with CSS classes; the animation lives in the stylesheet so
// prefers-reduced-motion can switch it off in one place.

const SKIN = 'fig-skin';
const CLOTH = 'fig-cloth';

/** One front-facing person. `lit` decides which half glows: 'body' | 'clothes' | 'all'. */
export function person(lit = 'all', scale = 1) {
  const w = 100 * scale, h = 180 * scale;
  return `
<svg class="fig fig-lit-${lit}" viewBox="0 0 100 180" width="${w}" height="${h}"
     role="img" aria-hidden="true">
  <g class="${SKIN}">
    <circle cx="50" cy="22" r="15"/>
    <rect x="44" y="34" width="12" height="9" rx="3"/>
    <rect x="20" y="82" width="11" height="26" rx="5"/>
    <rect x="69" y="82" width="11" height="26" rx="5"/>
    <rect x="37" y="139" width="11" height="26" rx="5"/>
    <rect x="52" y="139" width="11" height="26" rx="5"/>
    <ellipse cx="42.5" cy="168" rx="8" ry="5"/>
    <ellipse cx="57.5" cy="168" rx="8" ry="5"/>
  </g>
  <g class="${CLOTH}">
    <path d="M34 43 L66 43 Q74 45 76 54 L80 86 L67 89 L65 66 L65 104 L35 104 L35 66
             L33 89 L20 86 L24 54 Q26 45 34 43 Z"/>
    <path d="M35 104 L65 104 L64 143 L53 143 L50 118 L47 143 L36 143 Z"/>
  </g>
</svg>`;
}

/** Two people and an arrow: the outfit swap, which is otherwise the hardest to picture. */
export function swapPair() {
  return `
<div class="fig-pair">
  <div class="fig-slot"><div class="fig-cap">body</div>${person('body', 0.62)}</div>
  <div class="fig-arrow" aria-hidden="true">
    <svg viewBox="0 0 40 30" width="34" height="26">
      <path d="M4 15 H30 M23 8 L31 15 L23 22" fill="none" stroke="currentColor"
            stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <div class="fig-slot"><div class="fig-cap">clothes</div>${person('clothes', 0.62)}</div>
</div>`;
}

/** One original plus copies alongside it -- "these coexist, nothing is overwritten". */
export function copies() {
  return `
<div class="fig-pair fig-copies">
  <div class="fig-slot">${person('all', 0.52)}</div>
  <div class="fig-slot fig-ghost fig-d1">${person('clothes', 0.52)}</div>
  <div class="fig-slot fig-ghost fig-d2">${person('clothes', 0.52)}</div>
</div>`;
}

/** One person whose clothing cycles colour -- "this replaces what everyone sees". */
export function recolour() {
  return `<div class="fig-pair fig-recolour"><div class="fig-slot">${person('clothes', 0.62)}</div></div>`;
}

export const ART = { variants: copies, replace: recolour, swap: swapPair };
