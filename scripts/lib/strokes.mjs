// Stroke data: where it comes from, and the one shape every later step reads.
//
// character.json:
// {
//   "char": "永",
//   "viewBox": "0 0 200 200",          // always starts at 0 0; the longer side is about 200 units
//   "brushWidth": 18,                  // optional; units, the brush that writes the main ink
//   "strokes": [{
//     "id": "s1",
//     "body": "M… Z",                  // the stroke's filled outline
//     "trace": "M…",                   // its centerline, in writing direction
//     "ending": "press" | "flick",     // 顿笔 (decelerate and rest) or 出锋 (lift off moving, dry tail)
//     "component": 0,                  // strokes of one component (radical) share a number
//     "group": 0,                      // optional sub-group inside a component
//     "tempo": 1, "pauseAfter": null, "dry": null   // optional per-stroke overrides
//   }]
// }
import { transformPath, smoothPath, sample, polygons, insidePolygons, bounds } from './path.mjs';

export const UNITS = 200;

const HANZI_DATA = (char) => `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(char)}.json`;

/** Downloads a character's strokes and medians from hanzi-writer-data (derived from Make Me a Hanzi). */
export async function fetchHanziWriter(char) {
  const url = HANZI_DATA(char);
  let text = null, lastError = null;
  try {
    const res = await fetch(url);
    if (res.status === 404) throw new Error(`hanzi-writer-data has no entry for ${char}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    lastError = e;
    if (/no entry/.test(e.message)) throw e;
    // Node's fetch ignores HTTP(S)_PROXY; curl honours it.
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('curl', ['-sSfL', '--max-time', '40', url], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout) text = r.stdout;
  }
  if (!text) throw new Error(`Could not download ${url}: ${lastError?.message ?? 'no response'}. Check the network or pass your own strokes with "import".`);
  return JSON.parse(text);
}

/**
 * hanzi-writer-data → character.json. Its glyphs live in a 1024 box with y pointing up (baseline at 900);
 * they are flipped and scaled to UNITS. Medians become smooth traces with rounded corners at 折.
 */
export function fromHanziWriter(data, char) {
  const k = UNITS / 1024;
  const map = ([x, y]) => [x * k, (900 - y) * k];
  // Components: the radical and the rest, when the radical is written in one go (弓 then 長 in 張). Where
  // its strokes interleave with the others (我), the whole character counts as one component.
  const radIdx = [...(data.radStrokes ?? [])].sort((a, b) => a - b);
  const contiguous = radIdx.length > 0 && radIdx.length < data.strokes.length && radIdx[radIdx.length - 1] - radIdx[0] === radIdx.length - 1;
  const rad = new Set(contiguous ? radIdx : []);
  let component = 0;
  const strokes = data.strokes.map((d, i) => {
    if (i > 0 && rad.has(i) !== rad.has(i - 1)) component++;
    const body = transformPath(d, map, true);
    const pts = data.medians[i].map(map);
    const trace = extendTrace(smoothPath(pts), body);
    return { id: `s${i + 1}`, body, trace, component };
  });
  const character = { char, viewBox: `0 0 ${UNITS} ${UNITS}`, source: 'hanzi-writer-data (Make Me a Hanzi, Arphic Public License)', strokes };
  for (const s of character.strokes) s.ending = guessEnding(s);
  return character;
}

/**
 * Median lines often stop short of a stroke's tip; the brush has to reach the end of the ink. Extends the
 * trace straight on at both ends by up to 4 units while it stays inside the body.
 */
function extendTrace(trace, body) {
  const polys = polygons(body, 16);
  const { pts } = sample(trace, 24);
  const reach = (p, q) => {
    const dx = p.x - q.x, dy = p.y - q.y, l = Math.hypot(dx, dy) || 1;
    let d = 0;
    while (d < 4 && insidePolygons(polys, p.x + (dx / l) * (d + 0.25), p.y + (dy / l) * (d + 0.25))) d += 0.25;
    return [p.x + (dx / l) * d, p.y + (dy / l) * d];
  };
  const first = pts[0], second = pts[Math.min(3, pts.length - 1)];
  const last = pts[pts.length - 1], before = pts[Math.max(0, pts.length - 4)];
  const [sx, sy] = reach(first, second);
  const [ex, ey] = reach(last, before);
  const f = (v) => String(Math.round(v * 100) / 100);
  const head = Math.hypot(sx - first.x, sy - first.y) > 0.3 ? `M${f(sx)} ${f(sy)}L${f(first.x)} ${f(first.y)}` : `M${f(first.x)} ${f(first.y)}`;
  const tail = Math.hypot(ex - last.x, ey - last.y) > 0.3 ? `L${f(ex)} ${f(ey)}` : '';
  return head + trace.replace(/^M[^A-Za-z]*/, '') + tail;
}

/**
 * Whether a stroke ends pressed (顿笔) or flicked (出锋): a flick tapers to a point, so its ink over the
 * last stretch of the trace is much narrower than the stroke's typical width.
 */
export function guessEnding(stroke) {
  const polys = polygons(stroke.body, 16);
  const { pts, length } = sample(stroke.trace, 40);
  const widthAt = (i) => {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    const tx = q.x - o.x, ty = q.y - o.y, l = Math.hypot(tx, ty) || 1;
    const nx = -ty / l, ny = tx / l;
    if (!insidePolygons(polys, p.x, p.y)) return 0;
    let a = 0, b = 0;
    while (a < 30 && insidePolygons(polys, p.x - nx * (a + 0.25), p.y - ny * (a + 0.25))) a += 0.25;
    while (b < 30 && insidePolygons(polys, p.x + nx * (b + 0.25), p.y + ny * (b + 0.25))) b += 0.25;
    return a + b;
  };
  const widths = pts.map((p, i) => ({ s: p.s, w: widthAt(i) })).filter((x) => x.w > 0);
  if (widths.length < 6) return 'press';
  const sorted = widths.map((x) => x.w).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  // Just before the ink ends, a rounded (pressed) end is still over half its width; a taper (出锋, a hook's
  // tip) has narrowed to a point.
  const onEnd = widths[widths.length - 1].s;
  const near = widths.filter((x) => x.s >= onEnd - 4 && x.s <= onEnd - 1.5);
  if (!near.length) return 'press';
  return Math.min(...near.map((x) => x.w)) < 0.45 * typical ? 'flick' : 'press';
}

/**
 * A user's own strokes → character.json: any viewBox, scaled so the longer side is UNITS and moved to 0 0.
 * Input: { char?, viewBox?, strokes: [{ body, trace, ...overrides }] }.
 */
export function normalizeCharacter(input) {
  if (!Array.isArray(input.strokes) || !input.strokes.length) throw new Error('No strokes: expected { strokes: [{ body, trace }] }');
  input.strokes.forEach((s, i) => {
    if (typeof s.body !== 'string' || typeof s.trace !== 'string') throw new Error(`Stroke ${i + 1} needs "body" (outline path) and "trace" (centerline path)`);
  });
  let [vx, vy, vw, vh] = (input.viewBox ?? '').split(/[\s,]+/).map(Number);
  if (![vx, vy, vw, vh].every(Number.isFinite)) {
    // No viewBox: fit the strokes' outlines with a margin.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of input.strokes) { const b = bounds(s.body); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    const m = 0.06 * Math.max(x1 - x0, y1 - y0);
    [vx, vy, vw, vh] = [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m];
  }
  // The model's constants are in units of a ~200-unit box; a box already near that size is kept as it is.
  const longest = Math.max(vw, vh);
  const k = longest >= 160 && longest <= 260 ? 1 : UNITS / longest;
  const map = ([x, y]) => [(x - vx) * k, (y - vy) * k];
  const same = k === 1 && vx === 0 && vy === 0;
  const round = (v) => Math.round(v * 1000) / 1000;
  const strokes = input.strokes.map((s, i) => {
    const out = { ...s, id: s.id ?? `s${i + 1}` };
    if (!same) { out.body = transformPath(s.body, map, true); out.trace = transformPath(s.trace, map, false); }
    out.ending ??= guessEnding(out);
    out.component ??= 0;
    return out;
  });
  const character = { ...input, viewBox: `0 0 ${round(vw * k)} ${round(vh * k)}`, strokes };
  if (input.brushWidth && !same) character.brushWidth = round(input.brushWidth * k);
  return character;
}

/** A short table of the strokes, for checking endings and components by eye. */
export function describe(character) {
  return character.strokes.map((s) => {
    const { pts, length } = sample(s.trace, 8);
    const a = pts[0], b = pts[pts.length - 1];
    const f = (v) => v.toFixed(0).padStart(3);
    return `${s.id.padEnd(5)} component ${s.component ?? 0}${s.group !== undefined ? ` group ${s.group}` : ''}  ${String(s.ending).padEnd(5)}  length ${f(length)}  from (${f(a.x)},${f(a.y)}) to (${f(b.x)},${f(b.y)})`;
  }).join('\n');
}
