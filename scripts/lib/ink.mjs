// The ink: each stroke rendered offline by a brush of bristles on rice paper, packed into one atlas.
//
// Per stroke:
// - core: what the brush lays down. The brush is a bundle of bristles, each carrying its own ink. Along the
//   stroke they run dry, the ones at the edge first, and where a bristle's ink no longer beats the paper's
//   tooth it skips, leaving 飞白. Ink pools where the brush rests (起笔, turns) and thins where it moves fast.
//   Speeds and rests are read from the timing the page plays.
// - halo: water from the wet parts of the stroke wicking into the paper (洇墨), furthest along the fibers,
//   carrying a little ink with it.
// The core is split in two: `main`, within the brush's reach of the trace (painted as the brush passes), and
// `rest`, the blobs beyond it (painted a moment later by a wider brush).
import { cubics, bez, bounds } from './path.mjs';
import { rasterizePath } from './raster.mjs';
import { mulberry32 } from './timing.mjs';

export const INK_MODEL = {
  scale: 6,                 // texture pixels per viewBox unit
  bristles: 72,
  tooth: [0.22, 0.3],       // ink a bristle needs to mark the paper: tooth[0] + tooth[1] * tooth
  skipSoftness: 0.06,
  poolSpread: 4.5,          // units a resting brush's extra ink spreads along the stroke
  fray: 2.2,                // texture px the edge wanders along the paper fibers
  haloReach: 2.0,           // units the wettest spots bleed
  haloMinCost: 0.45,        // cheapest step along a fiber, relative to plain paper
  haloInk: 0.2,
  brushMargin: 3,           // texture px the brush reaches past the `main` pixels
  dry: { press: 0.36, flick: 0.48 }, // how empty the brush is by the end of a stroke, by ending
  paperSeed: 11,
  ink: [17, 16, 15],
  paper: [251, 251, 249],
};

// ---------- noise and paper ----------

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, seed, octaves) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f, seed + o * 101);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

/** Rice paper: long thin fibers (the ink wicks along them) and the tooth a dry brush skips over. */
export function makePaper(W, H, seed) {
  const rand = mulberry32(seed);
  const fiber = new Float32Array(W * H);
  const count = Math.round((W * H) / 160);
  for (let n = 0; n < count; n++) {
    let x = rand() * W, y = rand() * H, th = rand() * Math.PI * 2;
    const len = 12 * Math.exp(rand() * Math.log(8));
    const strength = 0.3 + 0.7 * rand(), width = 0.5 + 0.7 * rand();
    const r = Math.ceil(width * 2.5);
    for (let t = 0; t < len; t += 0.7) {
      const cx = Math.round(x), cy = Math.round(y);
      for (let dy = -r; dy <= r; dy++) {
        const py = cy + dy;
        if (py < 0 || py >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const px = cx + dx;
          if (px < 0 || px >= W) continue;
          const v = strength * Math.exp(-((px - x) ** 2 + (py - y) ** 2) / (2 * width * width));
          const i = py * W + px;
          if (v > fiber[i]) fiber[i] = v;
        }
      }
      th += (rand() - 0.5) * 0.1;
      x += Math.cos(th) * 0.7;
      y += Math.sin(th) * 0.7;
    }
  }
  const tooth = new Float32Array(W * H);
  const cloud = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      tooth[i] = 0.65 * fbm(x / 1.7, y / 1.7, 3, 3) + 0.35 * fbm(x / 7, y / 7, 5, 3);
      cloud[i] = fbm(x / 60, y / 60, 9, 3);
    }
  }
  return { fiber, tooth, cloud };
}

// ---------- geometry ----------

/** The trace resampled every `step` units of arc length, in texture pixels, with unit tangents. */
function centerline(d, S, step = 0.2) {
  const dense = [];
  let len = 0, prev = null;
  for (const seg of cubics(d)) {
    for (let j = dense.length ? 1 : 0; j <= 200; j++) {
      const p = bez(seg, j / 200);
      if (prev) len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      dense.push({ x: p[0], y: p[1], s: len });
      prev = p;
    }
  }
  const n = Math.max(2, Math.ceil(len / step) + 1);
  const xs = new Float64Array(n), ys = new Float64Array(n), ss = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (len * i) / (n - 1);
    while (k < dense.length - 2 && dense[k + 1].s < s) k++;
    const a = dense[k], b = dense[k + 1];
    const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    xs[i] = (a.x + (b.x - a.x) * f) * S;
    ys[i] = (a.y + (b.y - a.y) * f) * S;
    ss[i] = s;
  }
  const tx = new Float64Array(n), ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3);
    const dx = xs[b] - xs[a], dy = ys[b] - ys[a], l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l; ty[i] = dy / l;
  }
  return { n, xs, ys, ss, tx, ty, length: len };
}

/** Speeds (units/ms) and rests along the stroke, decoded from its CSS linear() easing. */
export function brushMotion(timing, poolSpread = INK_MODEL.poolSpread) {
  const inner = timing.easing.slice(timing.easing.indexOf('(') + 1, timing.easing.lastIndexOf(')'));
  const pts = inner.split(',').map((p) => p.trim().split(/\s+/)).filter((p) => p.length === 2)
    .map(([y, x]) => ({ s: parseFloat(y) * timing.from - 1, t: (parseFloat(x) / 100) * timing.duration }));
  pts.pop(); // "1 100%": the dash jumping past the end once the brush has lifted
  const moves = [], rests = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dt = b.t - a.t, ds = b.s - a.s;
    if (dt <= 0) continue;
    if (ds < 1e-3) rests.push({ s: a.s, ms: dt });
    else moves.push({ s0: a.s, s1: b.s, v: ds / dt });
  }
  const speedAt = (s) => {
    if (s <= moves[0].s0) return moves[0].v;
    let lo = 0, hi = moves.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (moves[mid].s0 <= s) lo = mid; else hi = mid - 1; }
    return moves[lo].v;
  };
  const poolAt = (s) => rests.reduce((sum, r) => sum + (r.ms / 45) * Math.exp(-(((s - r.s) / poolSpread) ** 2)), 0);
  return { start: pts[0].s, end: pts[pts.length - 1].s, moves, speedAt, poolAt };
}

/** Exact Euclidean distance (px) from every pixel to the nearest pixel where `features` is 1 (Felzenszwalb). */
function distanceTo(features, w, h) {
  const INF = 1e20, m = Math.max(w, h);
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = features[i] ? 0 : INF;
  const pass = (n) => {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Separable Gaussian blur. */
function blur(src, w, h, sigma) {
  const r = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const norm = kernel.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += kernel[k + r] * src[y * w + clamp(x + k, 0, w - 1)];
      tmp[y * w + x] = sum / norm;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += kernel[k + r] * tmp[clamp(y + k, 0, h - 1) * w + x];
      out[y * w + x] = sum / norm;
    }
  }
  return out;
}

/** Max-heap of pixel indices keyed by a float, for spreading the halo from the wettest pixels first. */
class MaxHeap {
  constructor() { this.keys = []; this.ids = []; }
  get size() { return this.keys.length; }
  push(key, id) {
    const { keys, ids } = this;
    let i = keys.length;
    keys.push(key); ids.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] >= key) break;
      keys[i] = keys[p]; ids[i] = ids[p]; i = p;
    }
    keys[i] = key; ids[i] = id;
  }
  pop() {
    const { keys, ids } = this;
    const top = ids[0], topKey = keys[0];
    const key = keys.pop(), id = ids.pop();
    if (keys.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= keys.length) break;
        if (c + 1 < keys.length && keys[c + 1] > keys[c]) c++;
        if (keys[c] <= key) break;
        keys[i] = keys[c]; ids[i] = ids[c]; i = c;
      }
      keys[i] = key; ids[i] = id;
    }
    return [topKey, top];
  }
}

// ---------- one stroke ----------

function renderStroke(stroke, timing, paper, index, ctx) {
  const { K, W, H, S, referenceSpeed, brushRadius } = ctx;
  const rand = mulberry32(1000 + index * 7919);
  const [bx0, by0, bx1, by1] = bounds(stroke.body);
  const margin = Math.ceil(K.haloReach * S * 1.5) + 6;
  const rx = clamp(Math.floor(bx0 * S) - margin, 0, W - 1), ry = clamp(Math.floor(by0 * S) - margin, 0, H - 1);
  const rw = clamp(Math.ceil(bx1 * S) + margin + 1, rx + 1, W) - rx, rh = clamp(Math.ceil(by1 * S) + margin + 1, ry + 1, H) - ry;
  const n = rw * rh;
  const at = (i) => (Math.floor(i / rw) + ry) * W + (i % rw) + rx; // region index → canvas index

  const M = rasterizePath(stroke.body, S, rx, ry, rw, rh);
  const inside = new Uint8Array(n), outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) { inside[i] = M[i] >= 0.5 ? 1 : 0; outside[i] = 1 - inside[i]; }
  const dIn = distanceTo(outside, rw, rh);   // inside pixels: distance to the paper
  const dOut = distanceTo(inside, rw, rh);   // paper pixels: distance to the ink

  const line = centerline(stroke.trace, S);
  const motion = brushMotion(timing, K.poolSpread);
  const onLength = Math.max(motion.end - motion.start, 1);
  const ending = stroke.ending === 'flick' ? 'flick' : 'press';
  const dry = clamp((stroke.dry ?? K.dry[ending]) * ctx.dryness, 0, 0.95);
  const pressedEnd = ending === 'press';
  const B = K.bristles;

  // Bristles come in clumps that share their ink, so streaks come in mixed widths.
  const bristles = [];
  while (bristles.length < B) {
    const size = 1 + Math.floor(rand() * 5), clumpInk = 0.8 + 0.4 * rand(), clumpSeed = Math.floor(rand() * 1e6);
    for (let c = 0; c < size && bristles.length < B; c++) bristles.push({ clumpInk, clumpSeed });
  }
  bristles.forEach((b, j) => {
    b.v = -1 + (2 * (j + 0.5)) / B + (rand() - 0.5) * (1.2 / B);
    const edge = Math.abs(b.v);
    b.load = b.clumpInk * (1 - 0.25 * edge * edge) * (0.9 + 0.2 * rand());
    b.thirst = (1 + 1.3 * edge * edge) * (0.8 + 0.4 * rand()); // how fast it runs dry; edge hairs first
    b.seed = Math.floor(rand() * 1e6);
  });
  const reach = 1.6 * (2 / B);

  // The brush's own centerline for laying ink: each trace sample moved onto the middle of the ink run
  // across the stroke there, with that run's half-width (a trace can hug one edge of its stroke).
  // Samples in the air (before the brush lands, after it lifts) have none.
  const insideAt = (x, y) => {
    const ix = Math.floor(x) - rx, iy = Math.floor(y) - ry;
    return ix >= 0 && iy >= 0 && ix < rw && iy < rh && inside[iy * rw + ix] === 1;
  };
  const maxWidth = 20 * S;
  const runs = [];
  for (let k = 0; k < line.n; k++) {
    const nx = -line.ty[k], ny = line.tx[k];
    let best = null, start = null;
    for (let d = -maxWidth; d <= maxWidth + 0.5; d += 0.5) {
      const ink = d <= maxWidth && insideAt(line.xs[k] + nx * d, line.ys[k] + ny * d);
      if (ink && start === null) start = d;
      if (!ink && start !== null) {
        const a = start, b = d - 0.5, gap = a > 0 ? a : b < 0 ? -b : 0;
        if (gap <= 2 * S && (!best || gap < best.gap)) best = { a, b, gap };
        start = null;
      }
    }
    runs.push(best);
  }
  const halves = runs.filter(Boolean).map((r) => (r.b - r.a) / 2).sort((a, b) => a - b);
  if (!halves.length) throw new Error(`${stroke.id}: its trace never runs through its body`);
  // A run wider than 1.6x the typical one spans two legs that touch: stay near the trace, at the cap.
  const halfCap = 1.6 * halves[Math.floor(halves.length / 2)];
  const rawX = new Float64Array(line.n), rawY = new Float64Array(line.n), rawHalf = new Float64Array(line.n);
  runs.forEach((r, k) => {
    if (!r) return;
    let mid = (r.a + r.b) / 2, half = (r.b - r.a) / 2;
    if (half > halfCap) { mid = clamp(0, r.a + halfCap, r.b - halfCap); half = halfCap; }
    rawX[k] = line.xs[k] - line.ty[k] * mid;
    rawY[k] = line.ys[k] + line.tx[k] * mid;
    rawHalf[k] = Math.max(half, 0.5 * S);
  });
  const midX = new Float64Array(line.n), midY = new Float64Array(line.n), half = new Float64Array(line.n);
  for (let k = 0; k < line.n; k++) {
    if (!rawHalf[k]) continue;
    let sx = 0, sy = 0, sh = 0, count = 0;
    for (let j = Math.max(0, k - 7); j <= Math.min(line.n - 1, k + 7); j++) {
      if (rawHalf[j]) { sx += rawX[j]; sy += rawY[j]; sh += rawHalf[j]; count++; }
    }
    midX[k] = sx / count; midY[k] = sy / count; half[k] = sh / count;
  }

  // 1. Where the brush is over each pixel: its arc length, how far across the brush, and how the brush
  //    moves there (pressing, skimming, running dry).
  const haloPx = K.haloReach * ctx.bleed * S;
  const haloFar = haloPx / K.haloMinCost;
  const dC = new Float32Array(n).fill(Infinity), edgeCover = new Float32Array(n);
  const atS = new Float32Array(n), across = new Float32Array(n);
  const contact = new Float32Array(n), drying = new Float32Array(n), pool = new Float32Array(n), inked = new Float32Array(n);
  const dist = new Float64Array(line.n);
  for (let i = 0; i < n; i++) {
    if (!inside[i] && dOut[i] > haloFar + 2) continue;
    const px = (i % rw) + rx + 0.5, py = Math.floor(i / rw) + ry + 0.5;
    // Reach of the live brush, which follows the trace itself.
    let best = Infinity;
    for (let j = 0; j < line.n; j++) {
      const dx = px - line.xs[j], dy = py - line.ys[j], d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    dC[i] = Math.sqrt(best);
    let nearest = -1, nearestDist = Infinity;
    for (let j = 0; j < line.n; j++) {
      if (!half[j]) { dist[j] = Infinity; continue; }
      const dx = px - midX[j], dy = py - midY[j];
      dist[j] = Math.sqrt(dx * dx + dy * dy);
      if (dist[j] < nearestDist) { nearestDist = dist[j]; nearest = j; }
    }

    // Signed distance to the outline (px, positive inside), wandering out along the paper fibers. The
    // outline grows by a pixel and barely recedes, so strokes whose outlines only touch don't open a
    // hairline of paper between them.
    const c = at(i);
    let sd = inside[i] ? dIn[i] - 0.5 : -(dOut[i] - 0.5);
    if (M[i] > 0 && M[i] < 1) sd = M[i] - 0.5;
    sd += 1 + K.fray * clamp(0.8 * paper.fiber[c] + 0.6 * paper.tooth[c] - 0.62, -0.15, 1);
    edgeCover[i] = clamp(sd + 0.5, 0, 1);
    if (edgeCover[i] <= 0 || nearest < 0) continue;

    // The leg of the stroke this pixel sits most squarely under (legs are local minima of distance along
    // the trace; where the brush doubles back, several pass over a pixel).
    const offsetAt = (k) => -line.ty[k] * (px - midX[k]) + line.tx[k] * (py - midY[k]);
    let leg = nearest, legRatio = Infinity;
    for (let k = 0; k < line.n; k++) {
      if (!half[k] || (k > 0 && dist[k] > dist[k - 1]) || (k + 1 < line.n && dist[k] > dist[k + 1])) continue;
      const ratio = Math.abs(offsetAt(k)) / half[k];
      if (ratio < legRatio) { legRatio = ratio; leg = k; }
    }
    // Which hairs pass over a pixel depends on how far it is from the paper: where two legs merge, a pixel
    // at one leg's nominal edge can be deep inside the ink, under the middle of the brush.
    const offset = offsetAt(leg);
    const nominal = Math.min(Math.abs(offset) / half[leg], 1);
    const depth = inside[i] ? Math.max(0, 1 - dIn[i] / half[leg]) : 1;
    across[i] = Math.sign(offset || 1) * Math.min(nominal, depth);

    const s = line.ss[leg];
    const speed = motion.speedAt(s) / referenceSpeed;
    const sigma = clamp((s - motion.start) / onLength, 0, 1);
    // A pressed ending (顿笔) pushes the last of the ink out of the brush; a flicked one (出锋) lifts off dry.
    const pressing = pressedEnd ? smoothstep(0.8, 1, sigma) : 0;
    atS[i] = s;
    pool[i] = motion.poolAt(s);
    // Slow means pressing: more ink leaves the brush (起笔, turns, pressed endings); fast means skimming.
    contact[i] = clamp(1.1 - 0.12 * speed * speed, 0.7, 1.12) + 0.3 * smoothstep(0.5, 0.15, speed) + 0.5 * pool[i] + 0.4 * pressing;
    drying[i] = dry * sigma * sigma * (1 - 0.75 * pressing); // the brush empties faster toward the end
    inked[i] = 1;
  }

  // 2. The brush's wetness changes gradually over the paper, not with which leg a pixel is nearest to
  //    (blurs normalized over the inked pixels, so the paper around the stroke doesn't pale its edges).
  const inkedSum = blur(inked, rw, rh, 1.2 * S);
  const smoothContact = blur(contact, rw, rh, 1.2 * S), smoothDrying = blur(drying, rw, rh, 1.2 * S);

  // 3. The bristles: each lays ink where it still carries more than the paper's tooth asks for.
  const core = new Float32Array(n), tone = new Float32Array(n), wetness = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!inked[i]) continue;
    const c = at(i), s = atS[i], lateral = across[i];
    const norm = Math.max(inkedSum[i], 1e-4);
    const press = smoothContact[i] / norm, empty = smoothDrying[i] / norm;
    const threshold = K.tooth[0] + K.tooth[1] * paper.tooth[c];
    let sum = 0, weights = 0;
    const center = Math.round(((lateral + 1) / 2) * B);
    for (let j = Math.max(0, center - 4); j < Math.min(B, center + 5); j++) {
      const b = bristles[j];
      const wander = 0.03 * (noise(s * 0.25, 0.5, b.seed) - 0.5) * 2;
      const w = 1 - Math.abs(lateral - (b.v + wander)) / reach;
      if (w <= 0) continue;
      // A bristle's ink flickers slowly along the stroke, so its streak starts and stops in long runs.
      const flicker = 0.82 + 0.36 * noise(s * 0.09, 1.5, b.clumpSeed);
      const ink = b.load * flicker * (1 - empty * b.thirst * 1.35) * press;
      sum += w * smoothstep(threshold - K.skipSoftness, threshold + K.skipSoftness, ink);
      weights += w;
    }
    const wet = clamp((1 - empty) * press, 0, 1.6) + 0.4 * pool[i];
    const rim = 0.04 * smoothstep(0.7, 0.96, Math.abs(lateral)) * smoothstep(0.7, 1.1, wet);
    tone[i] = 0.96 + 0.04 * smoothstep(0.35, 0.95, wet) + rim;
    core[i] = edgeCover[i] * (weights > 0 ? sum / weights : 0);
    wetness[i] = wet;
  }
  const toneSum = blur(tone, rw, rh, S), toneWeight = blur(inked, rw, rh, S);
  for (let i = 0; i < n; i++) {
    if (core[i] > 0) core[i] *= clamp((toneSum[i] / Math.max(toneWeight[i], 1e-4)) * (0.98 + 0.02 * paper.cloud[at(i)]), 0, 1);
  }

  // 洇墨: water spreads from the wet edge into the paper, cheaper along fibers, until it runs out.
  const budget = new Float32Array(n).fill(-1);
  const heap = new MaxHeap();
  for (let i = 0; i < n; i++) {
    if (!inside[i] || dIn[i] > 1.5) continue;
    const b = haloPx * smoothstep(1.05, 1.75, wetness[i]);
    if (b > 0) { budget[i] = b; heap.push(b, i); }
  }
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const [b, i] = heap.pop();
    if (b < budget[i]) continue;
    const x = i % rw, y = Math.floor(i / rw);
    for (const [dx, dy, len] of STEPS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
      const j = ny * rw + nx;
      if (inside[j]) continue;
      const c = at(j);
      const cost = len * clamp(1 - 0.5 * paper.fiber[c] + 0.35 * (paper.tooth[c] - 0.5), K.haloMinCost, 1.3);
      const left = b - cost;
      if (left > budget[j]) { budget[j] = left; heap.push(left, j); }
    }
  }
  // A thin film of diluted ink out to the water's edge, grained by the paper.
  const haloInk = Math.min(0.35, K.haloInk * ctx.bleed);
  let halo = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (budget[i] <= 0 || inside[i]) continue;
    const c = at(i);
    halo[i] = haloInk * Math.sqrt(smoothstep(0, haloPx, budget[i])) * (0.85 + 0.15 * paper.tooth[c]);
  }
  halo = blur(halo, rw, rh, 0.6);
  for (let i = 0; i < n; i++) if (inside[i]) halo[i] = 0;

  // Split the core at the brush's reach. `main` keeps its pixels to 1px past the reach, and its brush reaches
  // brushMargin px past, so it paints them at full strength. `rest` shares a 2px band with it: the browser
  // resamples each texture, which would soften a hard hand-over into a light seam.
  const reachPx = brushRadius * S + 1;
  const main = new Float32Array(n), rest = new Float32Array(n);
  let restInk = 0, allInk = 0, restReach = 0, haloReach = 0;
  for (let i = 0; i < n; i++) {
    if (core[i] > 0) {
      allInk += core[i];
      if (dC[i] <= reachPx) main[i] = core[i];
      if (dC[i] > reachPx - 2) rest[i] = core[i];
      if (dC[i] > reachPx) {
        restInk += core[i];
        restReach = Math.max(restReach, dC[i]);
      }
    }
    if (halo[i] > 0.01) haloReach = Math.max(haloReach, dC[i]);
  }
  if (!restInk) rest.fill(0);

  let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity;
  for (let k = 0; k < line.n; k++) {
    tx0 = Math.min(tx0, line.xs[k]); tx1 = Math.max(tx1, line.xs[k]);
    ty0 = Math.min(ty0, line.ys[k]); ty1 = Math.max(ty1, line.ys[k]);
  }

  return {
    region: { rx, ry, rw, rh },
    layers: { main, rest, halo },
    flat: M,
    traceBox: [tx0 / S, ty0 / S, tx1 / S, ty1 / S],
    restShare: restInk / Math.max(allInk, 1e-6),
    restWidth: restReach ? 2 * (restReach / S) + 1 : 0,
    haloWidth: 2 * (Math.max(haloReach, restReach) / S) + 1,
  };
}

// ---------- atlas ----------

/** A layer cropped to its ink (plus 2px), as ink-colored RGBA pixels, with its place on the canvas. */
function cropLayer(alpha, region, ink) {
  const { rx, ry, rw } = region;
  let x0 = rw, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] <= 0.004) continue;
    const x = i % rw, y = Math.floor(i / rw);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(rw - 1, x1 + 2); y1 = Math.min(region.rh - 1, y1 + 2);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      rgba[o] = ink[0]; rgba[o + 1] = ink[1]; rgba[o + 2] = ink[2];
      rgba[o + 3] = Math.round(clamp(alpha[(y + y0) * rw + x + x0], 0, 1) * 255);
    }
  }
  return { x: rx + x0, y: ry + y0, w, h, rgba };
}

/**
 * Shelf-packs the crops into one atlas, tallest first, with a transparent gap between cells so resampling
 * at a cell's edge never picks up its neighbour. Sets each crop's `cell` and returns the atlas size.
 */
function pack(crops, maxWidth = 2048, gap = 4) {
  let x = gap, y = gap, shelf = 0, width = 0;
  for (const crop of [...crops].sort((a, b) => b.h - a.h)) {
    if (x + crop.w + gap > maxWidth) { x = gap; y += shelf + gap; shelf = 0; }
    crop.cell = [x, y, crop.w, crop.h];
    x += crop.w + gap;
    shelf = Math.max(shelf, crop.h);
    width = Math.max(width, x);
  }
  return { width, height: y + shelf + gap };
}

const round3 = (v) => Number(v.toFixed(3));

/**
 * Renders every stroke. `timing` is computeTiming()'s strokes; `brushWidth` is the width (units) of the
 * brush that writes the main ink. Returns the atlas pixels, the manifest, and the rendered layers (for
 * previews). `onStroke(i, ms)` reports progress.
 */
export function renderInk(character, timing, { brushWidth, dryness = 1, bleed = 1, model = {}, onStroke } = {}) {
  const K = { ...INK_MODEL, ...model, dry: { ...INK_MODEL.dry, ...(model.dry ?? {}) } };
  const [, , vw, vh] = character.viewBox.split(/[\s,]+/).map(Number);
  const S = K.scale, W = Math.ceil(vw * S), H = Math.ceil(vh * S);
  // The typical brush speed, weighted by distance travelled: speeds are judged relative to it.
  const allMoves = timing.flatMap((t) => brushMotion(t, K.poolSpread).moves).sort((a, b) => a.v - b.v);
  const totalDistance = allMoves.reduce((sum, m) => sum + (m.s1 - m.s0), 0);
  let referenceSpeed = allMoves[0].v;
  for (let acc = 0, i = 0; i < allMoves.length; i++) {
    acc += allMoves[i].s1 - allMoves[i].s0;
    if (acc >= totalDistance / 2) { referenceSpeed = allMoves[i].v; break; }
  }
  const paper = makePaper(W, H, K.paperSeed);
  const ctx = { K, W, H, S, referenceSpeed, brushRadius: brushWidth / 2, dryness, bleed };

  const rendered = [];
  const crops = [];
  character.strokes.forEach((stroke, i) => {
    const t0 = Date.now();
    const r = renderStroke(stroke, timing[i], paper, i, ctx);
    r.crops = Object.fromEntries(['main', 'rest', 'halo'].map((name) => [name, cropLayer(r.layers[name], r.region, K.ink)]));
    crops.push(...Object.values(r.crops).filter(Boolean));
    rendered.push(r);
    onStroke?.(i, Date.now() - t0, r);
  });

  const atlas = pack(crops);
  const pixels = Buffer.alloc(atlas.width * atlas.height * 4);
  for (const crop of crops) {
    const [cx, cy] = crop.cell;
    for (let y = 0; y < crop.h; y++) crop.rgba.copy(pixels, ((cy + y) * atlas.width + cx) * 4, y * crop.w * 4, (y + 1) * crop.w * 4);
  }

  const paintWidth = round3(2 * (brushWidth / 2 + K.brushMargin / S));
  // A texture's place, its atlas cell, and its pattern tile: the smallest box holding both the texture and
  // everything its brush can paint (the trace plus half the brush's width, plus a unit to spare). A pattern
  // as big as the whole character costs the browser a character-sized bitmap per layer, which it may drop
  // and redraw in patches, flickering.
  const texture = (crop, traceBox, width) => {
    if (!crop) return null;
    const x = crop.x / S, y = crop.y / S, w = crop.w / S, h = crop.h / S;
    const reach = width / 2 + 1;
    const x0 = Math.floor(Math.min(x, traceBox[0] - reach)), y0 = Math.floor(Math.min(y, traceBox[1] - reach));
    const x1 = Math.ceil(Math.max(x + w, traceBox[2] + reach)), y1 = Math.ceil(Math.max(y + h, traceBox[3] + reach));
    return { x: round3(x), y: round3(y), width: round3(w), height: round3(h), cell: crop.cell, tile: [x0, y0, x1 - x0, y1 - y0] };
  };
  const strokes = rendered.map((r) => ({
    main: texture(r.crops.main, r.traceBox, paintWidth),
    rest: texture(r.crops.rest, r.traceBox, r.restWidth),
    restWidth: round3(r.restWidth),
    halo: texture(r.crops.halo, r.traceBox, r.haloWidth),
    haloWidth: round3(r.haloWidth),
  }));
  return { atlas: { ...atlas, pixels }, manifest: { brushWidth: paintWidth, strokes }, rendered, canvas: { W, H, S }, K };
}

/** RGB pixels of the finished character on paper (`flat`: the plain filled outlines instead). */
export function previewPixels(result, { flat = false } = {}) {
  const { W, H } = result.canvas, { ink, paper } = result.K;
  const img = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { img[i * 3] = paper[0]; img[i * 3 + 1] = paper[1]; img[i * 3 + 2] = paper[2]; }
  for (const r of result.rendered) {
    const { rx, ry, rw, rh } = r.region;
    for (const layer of flat ? [r.flat] : [r.layers.halo, r.layers.rest, r.layers.main]) {
      for (let i = 0; i < rw * rh; i++) {
        const a = layer[i];
        if (a <= 0) continue;
        const c = ((Math.floor(i / rw) + ry) * W + (i % rw) + rx) * 3;
        for (let k = 0; k < 3; k++) img[c + k] = img[c + k] * (1 - a) + ink[k] * a;
      }
    }
  }
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(img[i]);
  return { pixels: out, width: W, height: H };
}

/** Median full width (units) of the strokes' ink, measured across each trace where it runs through its body. */
export function medianStrokeWidth(character, S = 3) {
  const widths = [];
  for (const stroke of character.strokes) {
    const [bx0, by0, bx1, by1] = bounds(stroke.body);
    const rx = Math.max(0, Math.floor(bx0 * S) - 2), ry = Math.max(0, Math.floor(by0 * S) - 2);
    const rw = Math.ceil(bx1 * S) + 3 - rx, rh = Math.ceil(by1 * S) + 3 - ry;
    const cover = rasterizePath(stroke.body, S, rx, ry, rw, rh, 3);
    const line = centerline(stroke.trace, S, 1);
    const ins = (x, y) => {
      const ix = Math.floor(x) - rx, iy = Math.floor(y) - ry;
      return ix >= 0 && iy >= 0 && ix < rw && iy < rh && cover[iy * rw + ix] >= 0.5;
    };
    for (let k = 0; k < line.n; k++) {
      if (!ins(line.xs[k], line.ys[k])) continue;
      const nx = -line.ty[k], ny = line.tx[k];
      let a = 0, b = 0;
      while (a < 40 * S && ins(line.xs[k] - nx * (a + 0.5), line.ys[k] - ny * (a + 0.5))) a += 0.5;
      while (b < 40 * S && ins(line.xs[k] + nx * (b + 0.5), line.ys[k] + ny * (b + 0.5))) b += 0.5;
      widths.push((a + b + 0.5) / S);
    }
  }
  widths.sort((x, y) => x - y);
  return widths.length ? widths[Math.floor(widths.length / 2)] : 12;
}
