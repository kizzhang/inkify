// When and how fast each stroke is written, following what handwriting research measures:
// - Duration grows with length^0.6 (isochrony: long strokes are written faster per unit).
// - The brush slows on curves: speed ∝ (curvature + κ0)^(-1/3), the two-thirds power law.
// - Within a stroke speed rises and falls like a bell (a Beta-shaped profile). A pressed ending (顿笔)
//   decelerates; a flicked ending (出锋) is still moving fast when the brush lifts.
// - 起笔: the brush touches down and rests before it moves; at sharp turns (折) it rests again.
// - Between strokes the brush lifts, travels through the air and re-aims: the pause grows with the distance.
// A "human" take adds what a metronome lacks:
// - Pauses are phrased by component: writers pause about a third longer between components (radicals) than
//   between strokes inside one, and a little longer before a group of strokes; inside a group strokes follow
//   each other faster, fastest out of a flicked ending.
// - The brush settles longer where a component begins, and tempo can drift per stroke.
// - Nothing repeats exactly: landings, turns, pauses, durations and velocity profiles vary a little,
//   seeded, so each seed is one reproducible take.
// Everything is baked into one CSS linear() easing per stroke, so the browser plays it without JavaScript.
import { sample, polygons, insidePolygons } from './path.mjs';

export const MODEL = {
  startDelayMs: 450,        // blank paper before the first stroke
  pressMs: 45,              // 起笔: resting on the paper before moving
  moveBaseMs: 35,           // moving time = moveBaseMs + moveMsPerUnit * (curvature-weighted length)^moveExponent
  moveMsPerUnit: 8.5,
  moveExponent: 0.6,
  kappa0: 1 / 40,           // curvature (1/unit) below which a path counts as straight
  cornerRadius: 6.8,        // a turn tighter than this radius is a 折 and gets a rest
  cornerRestMs: 45,
  penUpMs: 50,              // lifting and re-aiming the brush
  airSpeed: 1.3,            // units per ms travelled between strokes
  pressedEndRestMs: 25,     // 顿笔收笔: rest on the paper before lifting
  sampleMs: 12,             // spacing of the linear() points
  // Beta(a, b) velocity profiles: the peak sits at (a - 1) / (a + b - 2) of the moving time.
  profiles: { press: [2.1, 2.7], flick: [2.0, 1.35] },
  // Human take: pause factors after the last stroke of a component / a group, and inside a group.
  componentBreak: 1.45,
  groupBreak: 1.2,
  withinGroup: 0.85,
  afterFlick: 0.85,
  settleLanding: 1.3,       // the brush settles longer where a component begins
  // Spread from take to take: log-normal σ for times, ± for the Beta profile's a and b.
  jitter: { move: 0.08, pause: 0.18, rest: 0.25, profile: 0.15 },
};

export function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A factor around 1 whose logarithm is normally distributed with standard deviation sigma. */
function wobble(rand, sigma) {
  const gaussian = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return Math.exp(sigma * gaussian);
}

const steadyHand = (M) => ({
  tempo: 1,
  press: M.pressMs,
  cornerRest: () => M.cornerRestMs,
  profile: (ending) => M.profiles[ending],
});

function humanHand(stroke, firstInComponent, rand, M) {
  const tempo = (stroke.tempo ?? 1) * wobble(rand, M.jitter.move);
  const press = M.pressMs * (firstInComponent ? M.settleLanding : 1) * wobble(rand, M.jitter.rest);
  const da = (2 * rand() - 1) * M.jitter.profile, db = (2 * rand() - 1) * M.jitter.profile;
  return {
    tempo,
    press,
    cornerRest: () => M.cornerRestMs * wobble(rand, M.jitter.rest),
    profile: (ending) => [M.profiles[ending][0] + da, M.profiles[ending][1] + db],
  };
}

function betaCdf(a, b, n = 4000) {
  const cdf = new Float64Array(n + 1);
  let acc = 0, prev = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const v = t ** (a - 1) * (1 - t) ** (b - 1);
    acc += (prev + (Number.isFinite(v) ? v : 0)) / (2 * n);
    prev = Number.isFinite(v) ? v : 0;
    cdf[i] = acc;
  }
  return (t) => {
    const x = Math.min(Math.max(t, 0), 1) * n, i = Math.floor(x);
    const v = i >= n ? cdf[n] : cdf[i] + (cdf[i + 1] - cdf[i]) * (x - i);
    return v / cdf[n];
  };
}

function inverse(cdf, y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < y) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Timeline of one stroke: [{ t (ms from the stroke's start), s (arc length drawn) }] plus its geometry. */
function strokeMotion(stroke, hand, M) {
  const { pts, length } = sample(stroke.trace);
  const body = polygons(stroke.body);
  // The trace may start or end in the air outside the ink body; only the part on paper takes time.
  const firstIn = pts.findIndex((p) => insidePolygons(body, p.x, p.y));
  let lastIn = pts.length - 1;
  while (lastIn > 0 && !insidePolygons(body, pts[lastIn].x, pts[lastIn].y)) lastIn--;
  const on = pts.slice(Math.max(firstIn, 0), lastIn + 1);
  if (on.length < 2) throw new Error(`${stroke.id}: its trace never runs inside its body`);
  // Curvature jumps where two Bézier segments meet; average it over ±1.5 units of arc length.
  let lo = 0, hi = 0, sum = 0;
  const smooth = on.map((p) => {
    while (hi < on.length && on[hi].s <= p.s + 1.5) sum += on[hi++].kappa;
    while (on[lo].s < p.s - 1.5) sum -= on[lo++].kappa;
    return sum / (hi - lo);
  });
  on.forEach((p, i) => { p.kappa = smooth[i]; });

  // Effort per unit length rises with curvature (two-thirds power law).
  const effort = [0];
  for (let i = 1; i < on.length; i++) {
    const ds = on[i].s - on[i - 1].s;
    const k = (on[i].kappa + on[i - 1].kappa) / 2;
    effort.push(effort[i - 1] + ds * Math.cbrt((k + M.kappa0) / M.kappa0));
  }
  const totalEffort = effort[effort.length - 1];
  const moveMs = (M.moveBaseMs + M.moveMsPerUnit * totalEffort ** M.moveExponent) * hand.tempo;

  // Sharp turns: local curvature maxima tighter than cornerRadius, away from the ends.
  const corners = [];
  for (let i = 1; i < on.length - 1; i++) {
    const k = on[i].kappa;
    if (k > 1 / M.cornerRadius && k >= on[i - 1].kappa && k > on[i + 1].kappa
        && on[i].s - on[0].s > 6 && on[on.length - 1].s - on[i].s > 6
        && !corners.some((c) => Math.abs(c.s - on[i].s) < 8)) {
      corners.push({ s: on[i].s, effort: effort[i] / totalEffort });
    }
  }

  const ending = stroke.ending === 'flick' ? 'flick' : 'press';
  const cdf = betaCdf(...hand.profile(ending));
  const sAtEffort = (e) => {
    const target = e * totalEffort;
    let a = 0, b = effort.length - 1;
    while (b - a > 1) { const mid = (a + b) >> 1; if (effort[mid] < target) a = mid; else b = mid; }
    const f = effort[b] === effort[a] ? 0 : (target - effort[a]) / (effort[b] - effort[a]);
    return on[a].s + f * (on[b].s - on[a].s);
  };

  const timeline = [];
  const sStart = on[0].s;
  timeline.push({ t: 0, s: sStart + 1.5 }, { t: hand.press, s: sStart + 1.5 });
  let rest = 0;
  const steps = Math.max(8, Math.ceil(moveMs / M.sampleMs));
  const pending = [...corners];
  for (let j = 1; j <= steps; j++) {
    const e = cdf(j / steps);
    // Rest at a corner the moment the brush reaches it.
    while (pending.length && pending[0].effort <= e) {
      const c = pending.shift();
      const t = hand.press + rest + moveMs * inverse(cdf, c.effort);
      const restMs = hand.cornerRest();
      timeline.push({ t, s: c.s }, { t: t + restMs, s: c.s });
      rest += restMs;
    }
    timeline.push({ t: hand.press + rest + (moveMs * j) / steps, s: Math.max(sAtEffort(e), sStart + 1.5) });
  }
  const last = timeline[timeline.length - 1];
  return { timeline, length, duration: last.t, ending, corners: corners.length, effort: totalEffort, start: pts[0], end: pts[pts.length - 1] };
}

const round = (v, digits) => Number(v.toFixed(digits));

/**
 * The timing of every stroke. `human` adds phrasing and seeded variation (`seed` picks the take).
 * Strokes may carry `ending` ('press' | 'flick'), `component` and `group` (numbers; a change starts a new
 * one), `tempo` (factor on moving time) and `pauseAfter` (factor on the pause after it, replacing the
 * phrasing). Returns the per-stroke CSS data and a readable report.
 */
export function computeTiming(strokes, { human = true, seed = 2, model = {} } = {}) {
  const M = { ...MODEL, ...model, jitter: { ...MODEL.jitter, ...(model.jitter ?? {}) }, profiles: { ...MODEL.profiles, ...(model.profiles ?? {}) } };
  let clock = M.startDelayMs;
  const out = [];
  const report = [];
  const rand = mulberry32(seed);
  strokes.forEach((stroke, i) => {
    const prev = strokes[i - 1];
    const firstInComponent = !prev || (stroke.component ?? 0) !== (prev.component ?? 0);
    const m = strokeMotion(stroke, human ? humanHand(stroke, firstInComponent, rand, M) : steadyHand(M), M);
    // The dash is one unit longer than the path and starts one unit before it, so nothing shows until it starts.
    const dash = Math.ceil(m.length) + 1;
    const from = dash + 1;
    const toProgress = (s) => (s + 1) / from;
    const points = m.timeline.map(({ t, s }) => ({ x: (100 * t) / m.duration, y: toProgress(s) }));
    // Hidden while the delay runs (input 0 → 0), then the brush lands within the first 0.1% of the stroke.
    const easing = ['0', ...points.map(({ x, y }, j) => `${round(y, 4)} ${j === 0 ? '0.1' : round(x, 2)}%`), '1 100%'];
    const delay = Math.round(clock);
    const duration = Math.round(m.duration);
    out.push({ delay, duration, easing: `linear(${easing.join(', ')})`, dash, from });

    const next = strokes[i + 1];
    let pause = 0;
    if (next) {
      const nextStart = sample(next.trace, 4).pts[0];
      const air = Math.hypot(nextStart.x - m.end.x, nextStart.y - m.end.y);
      pause = M.penUpMs + air / M.airSpeed + (m.ending === 'press' ? M.pressedEndRestMs : 0);
      if (human) {
        const phrasing = stroke.pauseAfter
          ?? ((next.component ?? 0) !== (stroke.component ?? 0) ? M.componentBreak
            : (next.group ?? 0) !== (stroke.group ?? 0) ? M.groupBreak
              : M.withinGroup * (m.ending === 'flick' ? M.afterFlick : 1));
        pause *= phrasing * wobble(rand, M.jitter.pause);
      }
    }
    report.push(`${String(stroke.id).padEnd(10)} length ${m.length.toFixed(0).padStart(4)}  ${m.ending.padEnd(5)}  corners ${m.corners}  starts ${String(delay).padStart(5)} ms  lasts ${String(duration).padStart(4)} ms  then pauses ${pause.toFixed(0).padStart(3)} ms`);
    clock += m.duration + pause;
  });
  return { human, seed: human ? seed : null, writtenAt: Math.round(clock), strokes: out, report };
}
