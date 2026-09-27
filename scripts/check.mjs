// Quick self-test: path parsing, rasterizing, the timing model (against the committed 張 example, which
// must match kizzhang.com's take 2 exactly) and the writer markup. No network, no dependencies.
//   node scripts/check.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sample, subpaths } from './lib/path.mjs';
import { rasterizePath, encodePNG } from './lib/raster.mjs';
import { normalizeCharacter } from './lib/strokes.mjs';
import { computeTiming } from './lib/timing.mjs';
import { inkWriterSVG } from './lib/writer.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// Paths: relative commands, quadratics and smooth quadratics become cubics of the right length.
check('straight line length', near(sample('M0 0 l30 40').length, 50, 1e-6));
check('quadratic → cubic', subpaths('M0 0 Q 50 100 100 0 T 200 0').flat().length === 2);
const arc = sample('M0 0 Q50 50 100 0').length;
check('quadratic length', near(arc, 114.779, 0.01), arc.toFixed(3));

// Rasterizing: a 10 × 10 square at 2 px per unit covers 400 px exactly.
const square = rasterizePath('M1 1 H11 V11 H1 Z', 2, 0, 0, 30, 30);
const area = square.reduce((s, v) => s + v, 0);
check('square coverage', near(area, 400, 0.5), area.toFixed(2));
check('PNG encoder', encodePNG(Buffer.alloc(4 * 4 * 4, 255), 4, 4).subarray(1, 4).toString() === 'PNG');

// Timing: the 張 example reproduces the committed take 2.
const example = JSON.parse(fs.readFileSync(`${root}examples/zhang/strokes.json`, 'utf8'));
const expected = JSON.parse(fs.readFileSync(`${root}examples/zhang/out/timing.json`, 'utf8'));
const timing = computeTiming(normalizeCharacter(example).strokes, { seed: 2 });
const same = timing.strokes.every((t, i) => JSON.stringify(t) === JSON.stringify(expected.strokes[i]));
check('timing take 2 reproduces the example', same && timing.writtenAt === expected.writtenAt, `${timing.writtenAt} ms`);
const steady = computeTiming(normalizeCharacter(example).strokes, { human: false });
check('steady model differs from the take', steady.writtenAt !== timing.writtenAt, `${steady.writtenAt} ms`);

// Writer: one brush and one still image per layer.
const data = JSON.parse(fs.readFileSync(`${root}examples/zhang/out/inkify.json`, 'utf8'));
const svg = inkWriterSVG(data);
const layers = data.strokes.reduce((n, s) => n + ['main', 'rest', 'halo'].filter((k) => s.ink[k]).length, 0);
check('writer markup', (svg.match(/class="ink-brush"/g) ?? []).length === layers && (svg.match(/class="ink-still"/g) ?? []).length === layers, `${layers} layers`);
check('still markup has no animation', !/ink-brush/.test(inkWriterSVG(data, { still: true })));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
