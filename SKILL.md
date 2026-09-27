---
name: inkify
description: "Write a Chinese character (or any stroke-ordered glyph) on a web page in real brush-and-ink, stroke by stroke, at a human hand's rhythm. Offline it renders each stroke with a brush of 72 bristles on rice paper (飞白 dry-brush streaks, ink pooling where the brush rests, 洇墨 bleed along paper fibers) into one texture atlas; the page then writes it with pure SVG + CSS animations that start on first paint, no JavaScript needed. Use for calligraphy intros and hero animations, name or logo reveals, 毛笔书写动画, 书法开场, 水墨字, 写字动画, or to turn a flat Hanzi Writer / stroke-dashoffset vector wipe into ink. Takes a character (stroke data fetched from hanzi-writer-data) or the user's own stroke outlines and centerlines."
---

# inkify: write a character in ink

inkify turns a character's strokes into a page that writes it with a brush. Three things make it read as
ink rather than a vector wipe, and each is its own step:

1. **Timing** — a motor-control model of a hand: isochrony, the two-thirds power law, bell-shaped speed,
   touch-down and corner rests, longer pauses between components, and seeded variation so each take differs.
2. **Ink** — an offline brush-and-paper renderer: bristles in clumps that run dry (edge hairs first) and skip
   the paper's tooth (飞白), ink pooling where the timing says the brush rests, a fibrous edge, and water
   wicking into the paper along its fibers (洇墨). It reads the timing, so ink and motion agree.
3. **Writing** — each stroke is an SVG path swept by `stroke-dashoffset` along its centerline, painted with
   that stroke's ink through a tight `<pattern>`, landing thin and pressing to full width, handing over to a
   plain image when done. Pure CSS; it starts with the first paint of prerendered HTML.

Run everything with `scripts/inkify.mjs` (Node 18+, no required dependencies; `sharp` makes the atlas a
WebP about 3× smaller). All steps read and write one folder, so any step can be rerun alone.

```bash
node scripts/inkify.mjs doctor
node scripts/inkify.mjs all 永 --out ./inkify-out/yong
```

## 1. Get the strokes

- **A standard character:** `fetch <char>` downloads outlines and median lines from hanzi-writer-data
  (Make Me a Hanzi; a Kaishu font, Arphic Public License; needs network to cdn.jsdelivr.net). It covers
  about 9,000 simplified and traditional characters.
- **The user's own lettering** (a traced calligraphy scan, a custom logo): write a JSON file
  `{ "char", "viewBox", "strokes": [{ "body", "trace" }] }` in writing order and run `import <file>`.
  `body` is the stroke's filled outline (SVG path: M L H V C S Q T Z; no arcs), `trace` its centerline in
  writing direction, starting where the brush lands. Any viewBox; it is scaled to about 200 units.
  A personal hand-traced glyph looks far more alive than a font's outlines; say so when it matters.

Both write `character.json` and print one line per stroke.

## 2. Review endings and components (do not skip)

Edit `character.json` before timing and rendering. The two guesses that most change the result:

- `ending`: `"press"` (顿笔: decelerates, rests, pushes out the last ink; heavy end) or `"flick"`
  (出锋: lifts off still moving; the tail runs dry into 飞白). The guess reads the outline's taper and is
  wrong on some strokes. By stroke type: 撇, 提, every 钩, 悬针竖 → `flick`; 点, 横, 垂露竖, 捺 → `press`.
- `component`: strokes of one component (radical) share a number; a change adds the pause a writer takes
  between components (about a third longer, measured). `fetch` fills it from the radical when the radical is
  written in one go; set it by hand for other structures (for 想: 木, 目, 心 → 0, 1, 2).

Optional per stroke: `group` (a sub-group inside a component; a small extra pause before it), `tempo`
(factor on moving time: >1 slower, e.g. 1.1 for a deliberate 捺), `pauseAfter` (factor on the pause after
it, replacing the phrasing), `dry` (0–0.95, how empty the brush is by the end). Top level: `brushWidth`
(units; default 1.25 × the median stroke width).

## 3. Timing: write a few takes, let the user pick

```bash
node scripts/inkify.mjs all character-or-file --takes 3      # take-1..3 folders and compare.html
node scripts/inkify.mjs timing <dir> --seed 2                # one take into an existing folder
node scripts/inkify.mjs timing <dir> --steady                # the plain model, no variation
```

Each seed is one reproducible "hand". Show the user `compare.html` and ask which take reads most like
someone writing; that is a judgement for their eye. A take changes the ink too (ink pools where that take
rests), so rerun `render` after changing the timing.

## 4. Render the ink

```bash
node scripts/inkify.mjs render <dir> [--dryness 1] [--bleed 1] [--brush 18] [--png]
```

Writes `ink.webp` (or `.png`), `ink.json` and `preview.png` (the finished character on paper). Look at
`preview.png` before building: tails of flicked strokes should show 飞白, pressed ends should be heavy, and
the bleed should be a faint fibrous rim, not a grey halo. `--dryness` scales how fast brushes run dry
(0.7 wetter, 1.3 drier); `--bleed` scales how far the wettest ink wicks. For symptoms (stripes, seams,
nothing written, flicker) read [references/tuning.md](references/tuning.md).

## 5. Build and check the page

```bash
node scripts/inkify.mjs build <dir> [--href /ink/zhang.webp]
```

Writes `index.html` (a standalone page that writes the character), `writer.html` (the SVG to paste),
`inkify.css`, `inkify.json` and `ink-writer.js`. `--href` is where the page will load the atlas from.

Check in a real browser before reporting success: open `index.html`, watch it write, click replay, and look
at a few frames mid-stroke and at the end. Confirm the final frame matches `preview.png` and the console is
clean. A `file://` page works because the atlas loads as an image; serve it over HTTP if the browser
refuses.

## 6. Put it on the user's site

Read [references/embedding.md](references/embedding.md). In short:

- Static HTML or any server-rendered page: paste `writer.html`'s SVG, include `inkify.css`, serve the atlas,
  preload it, and hold the writing (`ink-wait`) until it has loaded.
- React: copy [templates/InkWriter.tsx](templates/InkWriter.tsx) with `inkify.json`; it renders the same
  markup and works with SSR.
- Other frameworks: call `inkWriterSVG(data)` from `ink-writer.js` while rendering, or at build time.

Keep what the design gets for free: writing starts with first paint (no JS), `prefers-reduced-motion`
shows the finished ink, and finished strokes cost no pattern bitmaps (the flicker fix). Test in Safari and
Firefox too if the user's audience uses them; everything relies on SVG patterns, CSS `linear()` easing
(with a cubic-bezier fallback) and nested `<svg>` viewBoxes.

## How it works

[references/method.md](references/method.md) explains the brush, paper, ink and halo, the research each
part comes from, and what was deliberately left out. [references/timing.md](references/timing.md) covers the
motion model and every constant. Cite them when the user asks why it looks the way it does.
