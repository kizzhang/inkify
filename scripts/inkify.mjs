#!/usr/bin/env node
// inkify: write a character in ink. Strokes → human-rhythm timing → brush-and-paper ink → a page.
//
//   node scripts/inkify.mjs doctor
//   node scripts/inkify.mjs all <char | strokes.json> [--out dir] [--seed n | --takes n | --steady]
//                                                    [--dryness f] [--bleed f] [--brush w] [--png]
//   node scripts/inkify.mjs fetch <char> [--out dir]          hanzi-writer-data → character.json
//   node scripts/inkify.mjs import <strokes.json> [--out dir] your own outlines + centerlines → character.json
//   node scripts/inkify.mjs timing [dir] [--seed n | --steady]
//   node scripts/inkify.mjs render [dir] [--dryness f] [--bleed f] [--brush w] [--png]
//   node scripts/inkify.mjs build [dir] [--href url]
//
// Every step reads and writes files in one directory (default ./inkify-out/<char>), so a step can be rerun
// alone after editing character.json (endings, components, tempo) or changing a flag.
import fs from 'node:fs';
import path from 'node:path';
import { fetchHanziWriter, fromHanziWriter, normalizeCharacter, describe } from './lib/strokes.mjs';
import { computeTiming } from './lib/timing.mjs';
import { renderInk, previewPixels, medianStrokeWidth } from './lib/ink.mjs';
import { writeImage, encodePNG, loadSharp } from './lib/raster.mjs';
import { assemble, writeBuild, writeCompare } from './lib/build.mjs';

const argv = process.argv.slice(2);
const command = argv[0];
const positional = [];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; } else flags[key] = true;
  } else positional.push(a);
}
const num = (key, fallback) => (flags[key] === undefined ? fallback : Number(flags[key]));

const slug = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '-') || 'character';
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
const log = (...a) => console.log(...a);

function outDir(name) {
  const dir = path.resolve(flags.out ?? path.join('inkify-out', slug(name)));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function workDir() {
  const dir = path.resolve(positional[0] ?? '.');
  if (!fs.existsSync(path.join(dir, 'character.json'))) throw new Error(`No character.json in ${dir}. Run "fetch" or "import" first, or pass the directory.`);
  return dir;
}

async function getCharacter(source) {
  if (fs.existsSync(source) && fs.statSync(source).isFile()) {
    const input = readJSON(source);
    const character = normalizeCharacter(input);
    return { character, name: character.char || path.basename(source, path.extname(source)) };
  }
  if ([...source].length !== 1) throw new Error(`"${source}" is neither a strokes JSON file nor a single character`);
  const data = await fetchHanziWriter(source);
  return { character: fromHanziWriter(data, source), name: source };
}

function saveCharacter(dir, character) {
  writeJSON(path.join(dir, 'character.json'), character);
  log(describe(character));
  log(`\nwrote ${path.join(dir, 'character.json')}`);
  log('Check each stroke\'s ending (press = 顿笔, flick = 出锋) and component (strokes of one radical share a number) before rendering.');
}

function runTiming(dir, character, { seed, steady }) {
  const timing = computeTiming(character.strokes, { human: !steady, seed });
  const { report, ...data } = timing;
  writeJSON(path.join(dir, 'timing.json'), data);
  log(report.join('\n'));
  log(`${steady ? 'steady model' : `take ${seed}`}: last stroke finishes at ${data.writtenAt} ms`);
  return data;
}

async function runRender(dir, character, timing) {
  const brushWidth = num('brush', character.brushWidth ?? Math.round(1.25 * medianStrokeWidth(character) * 10) / 10);
  const started = Date.now();
  log(`brush ${brushWidth} units wide; rendering ${character.strokes.length} strokes…`);
  const result = renderInk(character, timing.strokes, {
    brushWidth,
    dryness: num('dryness', 1),
    bleed: num('bleed', 1),
    onStroke: (i, ms, r) => log(`  ${character.strokes[i].id.padEnd(6)} ${String(ms).padStart(6)} ms  ink beyond the brush ${(100 * r.restShare).toFixed(1)}%`),
  });
  const want = flags.png ? 'ink.png' : 'ink.webp';
  for (const old of ['ink.png', 'ink.webp']) if (old !== want && fs.existsSync(path.join(dir, old))) fs.rmSync(path.join(dir, old));
  const written = await writeImage(path.join(dir, want), result.atlas.pixels, result.atlas.width, result.atlas.height);
  const manifest = { file: path.basename(written), atlas: { width: result.atlas.width, height: result.atlas.height }, ...result.manifest };
  writeJSON(path.join(dir, 'ink.json'), manifest);
  const preview = previewPixels(result);
  fs.writeFileSync(path.join(dir, 'preview.png'), encodePNG(preview.pixels, preview.width, preview.height, 3));
  const kb = (fs.statSync(written).size / 1024).toFixed(0);
  log(`atlas ${result.atlas.width}×${result.atlas.height}, ${kb} kB → ${written}${written.endsWith('.png') && !flags.png ? ' (install sharp for a WebP about half the size)' : ''}`);
  log(`finished ink → ${path.join(dir, 'preview.png')}  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  return manifest;
}

function runBuild(dir, character, timing, ink) {
  const data = assemble(character, timing, ink, flags.href ?? ink.file);
  const files = writeBuild(dir, data);
  log(`wrote ${files.join(', ')} in ${dir}`);
  log(`open ${path.join(dir, 'index.html')}`);
  return data;
}

async function main() {
  switch (command) {
    case 'doctor': {
      const major = Number(process.versions.node.split('.')[0]);
      log(`node ${process.versions.node} ${major >= 18 ? 'ok' : '— needs 18 or newer'}`);
      const sharp = await loadSharp();
      log(sharp ? 'sharp found: the atlas is written as WebP' : 'sharp not found: the atlas is written as PNG (about twice the size of WebP). For WebP: npm install sharp (in the skill folder or your project)');
      log('fetch needs network access to cdn.jsdelivr.net (hanzi-writer-data); import works offline.');
      return;
    }
    case 'fetch':
    case 'import': {
      if (!positional[0]) throw new Error(`Usage: ${command} <${command === 'fetch' ? 'char' : 'strokes.json'}> [--out dir]`);
      const { character, name } = await getCharacter(positional[0]);
      saveCharacter(outDir(name), character);
      return;
    }
    case 'timing': {
      const dir = workDir();
      runTiming(dir, readJSON(path.join(dir, 'character.json')), { seed: num('seed', 2), steady: !!flags.steady });
      return;
    }
    case 'render': {
      const dir = workDir();
      if (!fs.existsSync(path.join(dir, 'timing.json'))) throw new Error('No timing.json: run "timing" first (the ink pools where the brush rests).');
      await runRender(dir, readJSON(path.join(dir, 'character.json')), readJSON(path.join(dir, 'timing.json')));
      return;
    }
    case 'build': {
      const dir = workDir();
      for (const f of ['timing.json', 'ink.json']) if (!fs.existsSync(path.join(dir, f))) throw new Error(`No ${f}: run "timing" and "render" first.`);
      runBuild(dir, readJSON(path.join(dir, 'character.json')), readJSON(path.join(dir, 'timing.json')), readJSON(path.join(dir, 'ink.json')));
      return;
    }
    case 'all': {
      if (!positional[0]) throw new Error('Usage: all <char | strokes.json> [--out dir] [--seed n | --takes n | --steady]');
      const { character, name } = await getCharacter(positional[0]);
      const dir = outDir(name);
      saveCharacter(dir, character);
      const takes = flags.takes ? Array.from({ length: Number(flags.takes) }, (_, i) => i + 1) : null;
      if (!takes) {
        const timing = runTiming(dir, character, { seed: num('seed', 2), steady: !!flags.steady });
        runBuild(dir, character, timing, await runRender(dir, character, timing));
        return;
      }
      const made = [];
      for (const seed of takes) {
        const sub = path.join(dir, `take-${seed}`);
        fs.mkdirSync(sub, { recursive: true });
        writeJSON(path.join(sub, 'character.json'), character);
        log(`\n— take ${seed} —`);
        const timing = runTiming(sub, character, { seed, steady: false });
        runBuild(sub, character, timing, await runRender(sub, character, timing));
        made.push({ dir: `take-${seed}`, seed, writtenAt: timing.writtenAt });
      }
      writeCompare(dir, made);
      log(`\ncompare the takes: ${path.join(dir, 'compare.html')}`);
      return;
    }
    default:
      log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      if (command) process.exitCode = 1;
  }
}

main().catch((e) => { console.error(`inkify: ${e.message}`); process.exitCode = 1; });
