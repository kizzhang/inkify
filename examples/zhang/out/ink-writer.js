// The character written in ink with CSS animations only: builds the SVG markup from inkify.json.
// Browser-safe (no Node APIs): the build copies this file next to its output as ink-writer.js, so a site
// can call inkWriterSVG() while it renders its HTML, or in the browser.
//
// Each stroke is a brush moving along its centerline (stroke-dashoffset, driven by the stroke's linear()
// easing) whose paint is that stroke's rendered ink, held in a <pattern>. So the brush lays ink down instead
// of uncovering a flat shape. It lands on its tip and presses down; the blobs beyond its reach fill in just
// behind it (rest), and the ink bleeds into the paper after that (halo). A pattern costs the browser a
// bitmap of its tile, so a brush paints only while it writes: hidden before its stroke starts, and the
// moment it finishes it hands over to a plain image of the same ink.

/** How long after the brush the blobs beyond its reach (起笔 heads, hooks) fill in. */
export const REST_LAG_MS = 40;
/** How long after the brush the ink starts wicking into the paper (洇墨), and how long it takes to spread. */
export const BLEED_LAG_MS = 90;
export const BLEED_MS = 700;
/** The brush lands on its tip, LAND_WIDTH of its full width, and presses down while it rests where it landed. */
export const LAND_WIDTH = 0.3;
export const PRESS_OVERRUN_MS = 60;

export const INK_CSS = `/* inkify: a brush laying down ink; its animations (ink-write plus ink-press or ink-bleed, then ink-done) are inline. */
.ink-brush {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dashoffset: 0;
  /* Used where linear() is unsupported: the inline easings are then dropped. */
  animation-timing-function: cubic-bezier(0.45, 0.05, 0.35, 1);
}
/* Hidden until its stroke starts, so a brush is only painted while it writes. */
@keyframes ink-write {
  from { stroke-dashoffset: var(--ink-from); visibility: hidden; }
  to { stroke-dashoffset: 0; }
}
/* Touch-down: the brush lands on its tip (--ink-land wide, in viewBox units) and presses to full width. */
@keyframes ink-press {
  from { stroke-width: var(--ink-land); }
}
/* 洇墨: the ink wicking into the paper behind the brush spreads in. */
@keyframes ink-bleed {
  from { opacity: 0; }
}
/* Once written, a brush hands over to a plain image of its ink (.ink-still), at the same moment (inline delay). */
@keyframes ink-done {
  from, to { visibility: hidden; }
}
.ink-still {
  visibility: hidden;
  animation: ink-show 1ms forwards;
}
@keyframes ink-show {
  from, to { visibility: visible; }
}
/* Until the ink texture has arrived, hold the writing (add .ink-wait to an ancestor, remove it on load). */
.ink-wait .ink-brush, .ink-wait .ink-still { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .ink-brush { display: none; }
  .ink-still { animation: none; visibility: visible; }
}
`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** How long the brush rests where it lands: the first flat run of the stroke's easing. */
export function landingMs(timing) {
  const points = timing.easing.slice(timing.easing.indexOf('(') + 1, timing.easing.lastIndexOf(')')).split(',')
    .map((p) => p.trim().split(/\s+/)).filter((p) => p.length === 2)
    .map(([y, x]) => [parseFloat(y), parseFloat(x)]);
  let k = 0;
  while (k + 1 < points.length && points[k + 1][0] === points[0][0]) k++;
  return ((points[k][1] - points[0][1]) / 100) * timing.duration;
}

/** A texture: the atlas, cropped to the texture's cell and placed where the texture goes. */
function still(texture, atlas, cls = '', style = '') {
  const [x, y, w, h] = texture.cell;
  return `<svg${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''} x="${texture.x}" y="${texture.y}" width="${texture.width}" height="${texture.height}" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none"><image href="${esc(atlas.href)}" width="${atlas.width}" height="${atlas.height}"/></svg>`;
}

/** A texture as a paint for a brush: a pattern whose tile is only as big as its brush can reach. */
function pattern(id, texture, atlas) {
  const [tx, ty, tw, th] = texture.tile;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${tx}" y="${ty}" width="${tw}" height="${th}" viewBox="${tx} ${ty} ${tw} ${th}">${still(texture, atlas)}</pattern>`;
}

function animations(list) {
  const col = (f) => list.map(f).join(', ');
  return `animation-name:${col((a) => a.name)};animation-delay:${col((a) => `${a.delay}ms`)};animation-duration:${col((a) => `${a.ms}ms`)};animation-timing-function:${col((a) => a.easing)};animation-fill-mode:${col((a) => a.fill)}`;
}

/**
 * The SVG markup that writes the character. `data` is inkify.json: { char, viewBox, brushWidth, atlas:
 * { href, width, height }, strokes: [{ trace, timing, ink }] }. Options: `id` (prefix for pattern ids,
 * unique per character on a page), `still` (the finished ink, no animation), `offset` (ms added to every
 * delay), `className`, `title`.
 */
export function inkWriterSVG(data, { id, still: finished = false, offset = 0, className = 'ink-writer', title } = {}) {
  const prefix = id ?? `ink-${[...(data.char ?? 'x')].map((c) => c.codePointAt(0).toString(16)).join('')}`;
  const atlas = data.atlas;
  let defs = '', body = '';
  data.strokes.forEach((stroke, i) => {
    const t = { ...stroke.timing, delay: stroke.timing.delay + offset };
    const ink = stroke.ink;
    let g = '';
    const layers = [
      ['halo', ink.haloWidth, BLEED_LAG_MS, { name: 'ink-bleed', ms: BLEED_MS, easing: 'ease-out' }, t.delay + BLEED_LAG_MS + Math.max(t.duration, BLEED_MS)],
      ['rest', ink.restWidth, REST_LAG_MS, null, t.delay + REST_LAG_MS + t.duration],
      ['main', data.brushWidth, 0, null, t.delay + t.duration],
    ];
    for (const [name, width, lag, second, done] of layers) {
      const texture = ink[name];
      if (!texture) continue;
      if (finished) { g += still(texture, atlas); continue; }
      const pid = `${prefix}-${i + 1}-${name}`;
      defs += pattern(pid, texture, atlas);
      g += still(texture, atlas, 'ink-still', `animation-delay:${done}ms`);
      const start = t.delay + lag;
      const press = { name: 'ink-press', ms: Math.round(landingMs(t) + PRESS_OVERRUN_MS), easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' };
      const style = [
        `stroke-dasharray:${t.dash} ${2 * t.dash}`,
        `--ink-from:${t.from}`,
        `--ink-land:${(width * LAND_WIDTH).toFixed(2)}`,
        animations([
          { name: 'ink-write', delay: start, ms: t.duration, easing: t.easing, fill: 'backwards' },
          { ...(second ?? press), delay: start, fill: 'backwards' },
          { name: 'ink-done', delay: done, ms: 1, easing: 'linear', fill: 'forwards' },
        ]),
      ].join(';');
      g += `<path class="ink-brush" d="${stroke.trace}" stroke="url(#${pid})" stroke-width="${width}" style="${style}"/>`;
    }
    body += `<g>${g}</g>`;
  });
  const label = title ?? `${data.char ?? ''}, written with a brush`;
  return `<svg class="${className}" viewBox="${data.viewBox}" role="img" aria-label="${esc(label)}" style="overflow:visible;will-change:transform">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
}

/** ms after the markup first paints when the last stroke (and its bleed) has finished. */
export function writtenAt(data, offset = 0) {
  return Math.max(...data.strokes.map((s) => s.timing.delay + offset + BLEED_LAG_MS + Math.max(s.timing.duration, BLEED_MS)));
}
