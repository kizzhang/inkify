# How the ink is made

The brush look is not a filter on the page. Each stroke is rendered offline by a small brush-and-paper
model into a texture; the page only reveals that texture along the stroke, in time. Code:
[scripts/lib/ink.mjs](../scripts/lib/ink.mjs).

## Why offline

A flat vector wipe (a constant-width round mask sweeping the centerline, then the outline fading to solid
black: the Hanzi Writer / "animate calligraphy with SVG" approach) reads as a digital silhouette: no dry
brush, no pooling, no bleed. The references that avoid that look share one trait: the texture comes from
how the mark was made, not from a layer added afterwards. So the options were:

| Approach | Why not (here) |
| --- | --- |
| SVG filters (`feTurbulence` + `feDisplacementMap`) | Generic grain, recomputed every frame on an animating layer; nothing to do with how a brush runs dry. |
| Shaders (ink edge from noise + distance field; InkField-style domain warp) | Needs WebGL and JavaScript before the first stroke; fights any other GPU work on the page. |
| Fluid simulation (Curtis et al. watercolor, MoXi, Inkwash) | Far too heavy at runtime for one character. |
| Scanned real ink | The most authentic, but needs a brush-written sample for every character. |
| **Offline brush model, baked into textures** | Zero runtime cost; the page still writes with CSS on first paint. Chosen. |

(Tyler Hobbs's watercolor essay makes the same argument for baking generative texture offline; his stacked
translucent polygons give soft watercolor edges but not dry-brush streaks, so the core here is a bristle
model instead.)

## The brush: 72 bristles

Hairy-brush research (Xu et al. 2002; Wetbrush, Chen et al. 2015) explains 飞白 as individual bristles
carrying their own ink and running out one by one. Simulating bristle bending and splitting is the most
expensive and least rewarding part, so inkify keeps only the statistics:

- 72 bristles across the brush, grouped in **clumps of 1–5 that share an ink load**, so streaks come in
  mixed widths.
- **Edge hairs hold less ink and dry faster** (load × (1 − 0.25·e²), thirst × (1 + 1.3·e²), e = distance
  from the brush center, 0–1).
- Each bristle's ink **flickers slowly along the stroke** (low-frequency noise over arc length), so a
  streak breaks in long runs, not dots.
- **The 飞白 test:** a bristle marks the paper only where its remaining ink beats the paper's tooth
  (threshold 0.22 + 0.3 × tooth height, soft ±0.06). Dry brush therefore skips exactly the high points of
  the paper, drawn out along the bristle's line.

Each pixel is mapped to a position *across* the brush using the ink run's real width at that point, not the
centerline: a trace may hug one edge of its stroke, and mapping from it turns bristle streaks into barcode
stripes. Where the brush doubles back (a hook, a 折), each pixel is assigned to the pass it sits most
squarely under.

## The paper: one sheet, three jobs

A generated sheet at 6 px per unit: about 9,000 long, slowly turning fibers over two octaves of fine noise
(the tooth), plus a large-scale cloud. The same sheet decides:

1. where 飞白 falls (tooth),
2. how the outline frays (the edge is pushed out up to 2.2 px where fibers and tooth are strong),
3. where 洇墨 travels (fibers are cheap to wick along).

Using one sheet for all three is what makes the marks look like they sit on the same paper. (It is the
"noise plus distance field" idea from mattdesl's `ink.glsl`, with the paper itself as the noise.)

## The ink follows the motion

The renderer reads the timing the page will play (decoded back from each stroke's CSS `linear()` easing):

- **Slow means pressing, fast means skimming.** Contact rises where the brush moves slowly relative to the
  character's typical speed and drops where it moves fast.
- **Rests pool ink.** Every rest (landing, a 折, a pressed ending) adds ink proportional to its duration,
  spread about ±4.5 units along the stroke. This matches what motion research measures: the two-thirds
  power law slows the hand at turns, and calligraphy teachers apply the most force at stroke starts and
  turns (CalliSense, CHI 2025). A different take of the timing moves the pools with it.
- **Each stroke empties the brush** as progress² × its `dry` value. Flicked endings (出锋) run driest, so
  飞白 gathers in tails; pressed endings (顿笔) push the last ink out, so they end heavy.
- **Tone:** wetter ink is slightly darker, and wet edges darker still (ink collects at the rim as it
  dries; watercolor simulation calls it edge darkening). The range is a few percent: restraint reads as ink,
  a visible gradient reads as an effect.

## 洇墨: water wicking into the paper

MoXi (Chu & Tai, SIGGRAPH 2005) models ink percolating through paper fibers with a lattice Boltzmann
method; the point that matters is that the bleed is uneven and follows the fibers. inkify approximates it
with a water budget spread outward like a shortest-path search: water starts at the wettest edge pixels,
each step costs less along a fiber (down to 0.45 of plain paper), and a thin film of diluted ink is left
wherever water reaches. Only the wettest places (slow, resting, pressing) bleed at all: about 2 units on
plain paper, over twice that along fibers, at most ~18% ink. The aim is the soft edge of Shanghai
Animation Film Studio's ink films (《山水情》, 1988), not a grey glow.

## Writing it on the page

Each stroke is three layers, each a brush along the centerline whose paint is a `<pattern>` holding that
layer's texture:

| Layer | What | When |
| --- | --- | --- |
| main | ink within the brush's reach of the trace | with the brush |
| rest | ink beyond its reach (起笔 heads, hooks, outer curves) | 40 ms behind, by a wider brush |
| halo | 洇墨 | 90 ms behind, fading in over 0.7 s |

- **Touch-down:** the brush lands at 30% of its width and presses to full width over the landing rest plus
  60 ms (a brush tip lands before its belly; a robot that lowers the brush gradually looks human, one that
  drops it like a plotter does not).
- **Round front:** a moving brush leads with its round belly and trails its tip. Leading with the tip was
  tried and looked like a claw.
- **Tight tiles, then hand-over:** a pattern costs the browser a bitmap of its tile. Tiles as big as the
  whole character (29 of them) cost ~160 MB on a 2× screen and the browser dropped and redrew them in
  patches, flickering. Tiles are cut to what each brush can reach, and the frame a layer finishes it swaps
  to a plain `<image>` of identical pixels, so a finished character holds no patterns at all.

## Left out on purpose

- Bristle bending and splitting in 3D (Wetbrush): the statistical bristles above do the visible part.
- Real fluid flow (MoXi, Inkwash): replaced by the water budget; no color separation at the bleed's edge.
- Kubelka–Munk pigment mixing (Curtis et al.): one ink, alpha compositing.
- Scanned real ink: still the most authentic option. The timing and page code work unchanged with a
  scanned character; only outlines and centerlines need tracing.

## Sources

- Hanzi Writer and Make Me a Hanzi (the vector-wipe baseline and the stroke data): https://hanziwriter.org/ · https://github.com/skishore/makemeahanzi
- CSS-Tricks, Animate Calligraphy with SVG: https://css-tricks.com/animate-calligraphy-with-svg/
- Tyler Hobbs, A Guide to Simulating Watercolor Paint with Generative Art: https://www.tylerxhobbs.com/words/a-guide-to-simulating-watercolor-paint-with-generative-art
- mattdesl, ink.glsl: https://github.com/mattdesl/material/blob/master/lib/shader/ink.glsl
- Xu et al. (2002), A Solid Model Based Virtual Hairy Brush: https://onlinelibrary.wiley.com/doi/abs/10.1111/1467-8659.00589
- Chen et al. (2015), Wetbrush: https://dl.acm.org/doi/10.1145/2816795.2818066
- Curtis et al. (1997), Computer-Generated Watercolor: https://grail.cs.washington.edu/projects/watercolor/
- Chu & Tai (2005), MoXi: Real-Time Ink Dispersion in Absorbent Paper: https://dl.acm.org/doi/10.1145/1073204.1073221
- Inkwash: https://johnowhitaker.github.io/inkwash/about
- InkField: https://ileivoivm.github.io/inkField/tech/en/effects.html
- 《山水情》 Feeling from Mountain and Water (1988): https://archive.org/details/feelingsmountain
- Lingdong Huang, {Shan, Shui}* and robotic calligraphy: https://github.com/LingDong-/shan-shui-inf
- CalliSense (CHI 2025): https://arxiv.org/abs/2502.15883
