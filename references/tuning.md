# Tuning and troubleshooting

Change one thing, rerun the step it affects, look at `preview.png` (ink) or the page (motion).

## Knobs

| Want | Change | Rerun |
| --- | --- | --- |
| More or less 飞白 overall | `render --dryness 1.3` (drier) / `0.7` (wetter) | render, build |
| 飞白 in one stroke only | that stroke's `dry` (0–0.95; defaults: press 0.36, flick 0.48) | render, build |
| A heavy end instead of a dry tail | that stroke's `ending: "press"` | timing, render, build |
| More or less bleed | `render --bleed 1.5` / `0.5` | render, build |
| Thicker or thinner brush reach | `brushWidth` in character.json or `render --brush 20` | render, build |
| Slower or faster overall | per-stroke `tempo`, or the model constants in `scripts/lib/timing.mjs` | timing, render, build |
| A longer breath between parts | `component` / `group` numbers, or `pauseAfter` on a stroke | timing, render, build |
| A different "hand" | `timing --seed n`, or `all --takes 3` and pick | timing, render, build |
| Start later on the page | `inkWriterSVG(data, { offset: 800 })`, or the React `offset` prop | nothing |

The ink depends on the timing (pools form where the brush rests), so rerun `render` after any timing change.

## Symptoms

| You see | Cause | Fix |
| --- | --- | --- |
| Nothing written, or strokes appear all at once at the end | The atlas didn't load before the writing started, or `href` points to the wrong place | Serve the atlas at `data.atlas.href` (or `build --href`), preload it, keep the `ink-wait` hold |
| Blocky patches or flicker late in the animation | Pattern bitmaps evicted under memory pressure (large tiles, heavy WebGL on the same page) | Keep the tight tiles and the hand-over to `.ink-still`; give the SVG `will-change: transform`; don't enlarge pattern tiles |
| Streaks run across a stroke like a barcode | The trace hugs one edge, or a trace leg runs outside the body | Trace nearer the middle of the stroke; keep traces inside their bodies except at the very ends |
| A pale seam inside a stroke | Two layers meeting without overlap, or a trace that skips part of the body | Make sure the trace runs the full length of the body; the renderer overlaps main/rest by 2 px |
| Heads or hooks appear late or never | Ink beyond the brush's reach is in the `rest` layer; a very small `brushWidth` pushes too much there | Raise `brushWidth` (render prints the share of ink beyond the brush; under ~5% is normal) |
| The brush front looks like a claw | Tip-first fronts were tried and rejected; the front is the round brush cap | Keep `stroke-linecap: round` |
| A stroke has jerky rests mid-way | The trace has tight kinks (many curvature peaks under 6.8 units radius) | Smooth the trace; each sharp kink is read as a 折 and gets a rest |
| "its trace never runs inside its body" | Trace and body don't overlap (wrong order, flipped y, different viewBox) | Check both use the same coordinates; for y-up data flip y |
| Endings look wrong (dry where it should be heavy) | `ending` guessed wrong | Set it by stroke type: 撇 提 钩 悬针竖 → flick; 点 横 垂露竖 捺 → press |
| PNG atlas is large | `sharp` not installed | `npm install sharp` in the skill folder or the project, rerun render |

## Performance

A 12-stroke character renders in under 10 s. The atlas is ~70–120 KB as WebP (~3× as PNG); preload it with
`fetchpriority="high"`. At runtime at most 2–4 patterns are alive at once, and none after the character is
written.
