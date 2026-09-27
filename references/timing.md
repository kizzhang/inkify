# The motion model

Code: [scripts/lib/timing.mjs](../scripts/lib/timing.mjs). Output: one CSS `linear()` easing per stroke
(its velocity profile with rests baked in), a delay and a dash length, so the browser plays it without
JavaScript.

## Inside a stroke

- **Isochrony.** Moving time = 35 ms + 8.5 ms × (curvature-weighted length)^0.6: long strokes are written
  faster per unit than short ones.
- **Two-thirds power law.** Speed ∝ (curvature + κ0)^(−1/3), κ0 = 1/40 per unit: the hand slows on curves.
  Implemented as "effort" per unit length ∝ ∛((κ + κ0)/κ0); time is spent evenly per unit of effort.
- **Bell-shaped speed.** Progress along the effort follows a Beta(a, b) CDF: pressed endings (顿笔)
  Beta(2.1, 2.7) decelerate into the end; flicked endings (出锋) Beta(2.0, 1.35) are still fast when the
  brush lifts.
- **Touch-down (起笔).** The brush rests 45 ms where it lands before moving.
- **Turns (折).** Curvature peaks tighter than a 6.8-unit radius, more than 6 units from either end, get a
  45 ms rest when the brush reaches them.
- **Pressed ending.** 25 ms on the paper before lifting.

## Between strokes

Pause = 50 ms (lift and re-aim) + air distance / 1.3 units per ms (+25 ms after a pressed ending).

## A human take (the default)

A metronome is what gives machine writing away. The take adds, from handwriting studies:

| Effect | Value | Why |
| --- | --- | --- |
| Pause after the last stroke of a component | × 1.45 | Writers pause about a third longer between components than between strokes inside one, at the same distance (a stroke-level database of Chinese handwriting: ~151 vs ~113 ms). |
| Pause before a new group inside a component | × 1.2 | Phrasing inside a component (長's lower half). |
| Pause inside a group | × 0.85, × 0.85 again after a flick | Strokes in a group flow together (笔断意连); a flick's momentum carries into the next stroke. |
| First landing of a component | × 1.3 | The brush settles where a component begins. |
| Per-stroke `tempo` | e.g. 1.1 warming up, 0.95 in rhythm, 1.12 for a slow 捺 | Tempo drifts over a character. |
| Jitter (log-normal σ) | moving 0.08, pauses 0.18, rests 0.25; Beta a, b ± 0.15 | Nothing repeats exactly. |

The jitter is seeded (mulberry32): each `--seed` is one reproducible take. Write three and let a person
choose; the example 張 on kizzhang.com is take 2. `--steady` writes the plain model.

Perception research agrees this matters: lines drawn with human kinematics are rated more natural and more
pleasing than the same lines drawn at constant speed (Chamberlain et al., 2022). calligrapher.ai's
convincing handwriting comes almost entirely from rhythm, with a fixed pen width.

## Easing format

`linear(0, y0 0.1%, y1 x1%, …, 1 100%)`: the input stays 0 during the animation delay; the brush lands
within the first 0.1% of the stroke's time; `y` is dash progress ((arc length + 1) / (dash + 1)); a
repeated `y` is a rest. The final `1 100%` jumps the dash past the end once the brush has lifted. Where
`linear()` is unsupported the inline easing is dropped and `.ink-brush` falls back to a cubic-bezier.

## Sources

- Plamondon (1995), A kinematic theory of rapid human movements: https://link.springer.com/article/10.1007/BF00202785
- Lacquaniti, Terzuolo & Viviani (1983), the two-thirds power law: https://pubmed.ncbi.nlm.nih.gov/6666647/
- A stroke-level large-scale database of Chinese character handwriting (Behavior Research Methods, 2026): https://link.springer.com/article/10.3758/s13428-026-03001-4
- Chamberlain et al. (2022), A dot that went for a walk: https://bpspsychub.onlinelibrary.wiley.com/doi/10.1111/bjop.12527
- CalliSense (CHI 2025): https://arxiv.org/abs/2502.15883
- calligrapher.ai: https://www.calligrapher.ai/
