# Putting it on a site

`build` writes everything a page needs:

| File | Use |
| --- | --- |
| `ink.webp` / `ink.png` | The atlas: every stroke's ink. Serve it; the markup points to `data.atlas.href`. |
| `inkify.css` | Keyframes and classes (`.ink-brush`, `.ink-still`, `.ink-wait`, reduced motion). |
| `writer.html` | The SVG markup, ready to paste. |
| `inkify.json` | The data: viewBox, traces, timing, ink boxes, atlas size. |
| `ink-writer.js` | `inkWriterSVG(data, options)`: builds the same markup (browser-safe ES module). |
| `index.html` | A standalone page that writes the character. |

## Static HTML or any server-rendered page

```html
<link rel="preload" as="image" href="/ink/zhang.webp" fetchpriority="high">
<link rel="stylesheet" href="/inkify.css">
<script>
  // Hold the writing until the ink has arrived (no-JS visitors just see it write).
  document.documentElement.classList.add('ink-wait');
  const img = new Image();
  img.onload = img.onerror = () => document.documentElement.classList.remove('ink-wait');
  img.src = '/ink/zhang.webp';
</script>
…
<!-- paste writer.html here, sized by CSS: -->
<div style="width: min(70vmin, 560px)"> <svg class="ink-writer" …>…</svg> </div>
```

Build with `--href /ink/zhang.webp` so the markup points at the served path. The SVG scales to its
container; `overflow: visible` lets the bleed spill slightly past the viewBox.

The animation clock starts when the SVG is first rendered. To restart (a replay button), replace the SVG
with a clone of itself. To start later, build the markup with `inkWriterSVG(data, { offset: ms })`.

## React / Next.js

Copy `templates/InkWriter.tsx`, `inkify.json`, the atlas and `inkify.css`:

```tsx
import data from './inkify.json';
import InkWriter from './InkWriter';

<InkWriter data={data} atlasHref="/ink/zhang.webp" className="w-[min(70vmin,560px)]" />
```

It renders the same markup as `writer.html`, so server rendering works and the writing starts before
hydration. Remount it (change its `key`) to replay.

## Other frameworks

`import { inkWriterSVG, INK_CSS } from './ink-writer.js'` and render the string at build time or on the
server (`innerHTML` in the browser also works). Pass `{ id }` to keep pattern ids unique if the same
character appears twice on one page.

## Behaviour to keep

- **First paint, no JS:** the writing is CSS animations on server-rendered markup.
- **Reduced motion:** `prefers-reduced-motion: reduce` hides the brushes and shows the finished ink.
- **Waiting for ink:** `.ink-wait` on an ancestor pauses every animation until the atlas has loaded, so a
  slow connection never "writes" invisible strokes.
- **No lingering patterns:** each layer hands over to a plain image the frame it finishes. If you restyle,
  keep `.ink-still` / `ink-done`; without them large pages flicker.
- **Dark pages:** the ink is black on transparent. Put it on a paper-colored card, or invert with
  `filter: invert(1)` on the SVG for light ink on a dark ground.

## Browser support

Relies on SVG `<pattern>` with a nested `<svg viewBox>`, CSS custom properties in keyframes, and the CSS
`linear()` easing (Chrome 113+, Safari 17.2+, Firefox 112+; older browsers fall back to a cubic-bezier per
stroke, which still writes but loses the rests). Check Safari and Firefox before shipping to a wide audience.
