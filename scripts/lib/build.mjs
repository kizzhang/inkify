// Writes what a page needs: inkify.json (data), inkify.css, ink-writer.js, writer.html (markup to paste)
// and index.html (a standalone page that writes the character).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inkWriterSVG, INK_CSS, writtenAt } from './writer.mjs';

const WRITER_SOURCE = fileURLToPath(new URL('./writer.mjs', import.meta.url));

/** inkify.json from the character, its timing and its ink. `href` is where the page will find the atlas. */
export function assemble(character, timing, ink, href) {
  return {
    char: character.char ?? '',
    viewBox: character.viewBox,
    brushWidth: ink.brushWidth,
    atlas: { href, width: ink.atlas.width, height: ink.atlas.height },
    seed: timing.seed,
    writtenAt: timing.writtenAt,
    strokes: character.strokes.map((s, i) => ({ id: s.id, trace: s.trace, timing: timing.strokes[i], ink: ink.strokes[i] })),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function demoPage(data) {
  const svg = inkWriterSVG(data);
  const seconds = (data.writtenAt / 1000).toFixed(2);
  const take = data.seed === null || data.seed === undefined ? 'steady model' : `take ${data.seed}`;
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.char)} · inkify</title>
<script>
  // Hold the writing until the ink has arrived, so no stroke is written invisibly on a slow connection.
  document.documentElement.classList.add('ink-wait');
  (() => {
    const img = new Image();
    img.onload = img.onerror = () => document.documentElement.classList.remove('ink-wait');
    img.src = ${JSON.stringify(data.atlas.href)};
  })();
</script>
<style>
${INK_CSS}
  :root { --paper: #f3efe6; --ink: #141312; --faint: #8a8377; --seal: #b0352a; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: grid;
    place-items: center;
    background:
      radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(80, 64, 40, 0.07)),
      var(--paper);
    color: var(--ink);
    font: 15px/1.6 "Songti SC", "Noto Serif SC", "Source Han Serif SC", "SimSun", Georgia, serif;
  }
  main { display: grid; justify-items: center; gap: 1.6rem; padding: 4vmin 16px; width: 100%; }
  .sheet { width: min(76vmin, 560px); aspect-ratio: 1; display: grid; place-items: center; }
  .ink-writer { width: 100%; height: auto; display: block; }
  footer { display: flex; gap: 1.2rem; align-items: center; color: var(--faint); font-size: 0.85rem; letter-spacing: 0.08em; }
  button { font: inherit; color: var(--ink); background: none; border: 1px solid rgba(20, 19, 18, 0.3); padding: 0.35rem 0.9rem; cursor: pointer; letter-spacing: 0.2em; }
  button:hover { border-color: var(--seal); color: var(--seal); }
  button:focus-visible { outline: 2px solid var(--seal); outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <div class="sheet" id="sheet">${svg}</div>
  <footer>
    <span>${esc(data.char)} · ${take} · ${seconds} s</span>
    <button type="button" id="replay">重写 replay</button>
  </footer>
</main>
<script>
  // Putting the same markup back restarts every animation from the top.
  document.getElementById('replay').addEventListener('click', () => {
    const svg = document.querySelector('#sheet svg');
    svg.replaceWith(svg.cloneNode(true));
  });
</script>
</body>
</html>
`;
}

/** Writes inkify.json, inkify.css, ink-writer.js, writer.html and index.html into `dir`. */
export function writeBuild(dir, data) {
  fs.writeFileSync(path.join(dir, 'inkify.json'), JSON.stringify(data, null, 1));
  fs.writeFileSync(path.join(dir, 'inkify.css'), INK_CSS);
  fs.copyFileSync(WRITER_SOURCE, path.join(dir, 'ink-writer.js'));
  fs.writeFileSync(path.join(dir, 'writer.html'), `<!-- inkify: ${data.char}. Needs inkify.css and ${data.atlas.href} next to the page. Starts writing when it first paints. -->\n${inkWriterSVG(data)}\n`);
  fs.writeFileSync(path.join(dir, 'index.html'), demoPage(data));
  return ['inkify.json', 'inkify.css', 'ink-writer.js', 'writer.html', 'index.html'];
}

/** A page with several takes side by side, to pick one. */
export function writeCompare(dir, takes) {
  const cells = takes.map((t) => `<figure><iframe src="${t.dir}/index.html" title="take ${t.seed}"></iframe><figcaption>take ${t.seed} · ${(t.writtenAt / 1000).toFixed(2)} s</figcaption></figure>`).join('\n  ');
  fs.writeFileSync(path.join(dir, 'compare.html'), `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>inkify · takes</title>
<style>
  body { margin: 0; padding: 24px 16px; background: #f3efe6; color: #141312; font: 14px/1.6 Georgia, "Songti SC", serif; }
  h1 { font-weight: 400; font-size: 1.1rem; letter-spacing: 0.1em; margin: 0 0 16px; }
  .takes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  figure { margin: 0; display: grid; gap: 6px; }
  iframe { width: 100%; aspect-ratio: 1 / 1.12; border: 1px solid rgba(20, 19, 18, 0.15); background: #f3efe6; }
  figcaption { color: #8a8377; letter-spacing: 0.08em; }
</style>
</head>
<body>
<h1>Pick the take that reads most like a hand. Each frame has its own replay button.</h1>
<div class="takes">
  ${cells}
</div>
</body>
</html>
`);
}

export { writtenAt };
