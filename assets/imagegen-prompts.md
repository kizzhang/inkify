# Image generation prompts

Generated with Codex ($imagegen skill, built-in image_gen tool). The first drafts were generated from a shared brief with a rendering of inkify's 張 as the style reference; these are the final revision prompts. The committed files are resized: logo.png to 440 px (from 1254), banner.jpg from a 1672 × 941 PNG, and icon-128/256.png from the logo.

## assets/logo.png

Use case: logo-brand
Asset type: square repository logo and app icon for inkify.
Correct the supplied logo by giving it a fully opaque warm off-white xuan rice-paper background (#f3efe6), filling every pixel of the entire square canvas with faint long paper fibers. The rice paper is an essential visible part of this artwork. No transparent background or cutout. Return a flattened opaque image.
Preserve the idea of a lowercase Latin i made from exactly two real calligraphy brush strokes: a heavy teardrop dot (点) above, clearly separated from a vertical stroke (竖) below. The vertical stroke lands pressed and heavy at its top, has a solid ink-black (#141312) body with subtle natural tonal variation and pooling, and ends in a dry-brush tail with visible white bristle streaks (飞白). Use soft fibrous ink edges with only a faint narrow grey bleed into the paper (洇墨). Keep the body solid black, without a raised or embossed edge. No shadow or large grey halo.
Composition: centered i, approximately 62% of the square canvas height, generous empty paper on all sides, recognizable at 32 px. Exactly one small square vermilion seal (#b0352a), beside the lower right of the i, with an abstract carved pattern and no legible characters. Vermilion is the only color accent.
Calm, restrained, authentic sumi ink on paper, museum-quality. No text or letters other than this brush-stroke i. No gradients, glossy or 3D effects, splatters, drips, drop shadows, frames, watermarks, or extra elements.

## assets/banner.jpg

Use case: ads-marketing
Asset type: landscape 16:9 README hero banner for inkify.
Input image 1 is the banner to revise. Input image 2 is the original brush-written 張 reference, used for the character shape and ink quality only.
Revise the right-side calligraphy to closely follow the actual flowing character shape in input image 2: the curving left 弓 with its long downward dry-brush tail, the broad flowing upper horizontals of 長, its lower curved strokes, and its long sweeping downward right tail. Preserve the reference's solid black stroke bodies, dry-brush white streaks at the tails (飞白), softly fibrous edges, pooling and narrow faint grey bleed (洇墨). Do not substitute generic angular calligraphy. It must remain the traditional character 張.
Replace the seal with exactly one small square vermilion (#b0352a) seal bearing an abstract carved geometric pattern, without any legible Chinese characters. Place it beside the lower right of 張.
Keep the left-side wording exactly correct, with these three lines:
"inkify"
"让每一笔都用墨写出来"
"72 bristles · rice-paper fibers · a human hand's rhythm"
The wordmark is all lowercase i-n-k-i-f-y in large elegant high-contrast serif; the Chinese line is medium refined Song/Ming serif; the English line is small, subtly letter-spaced, all on one line. Preserve the exact punctuation and spelling. Keep all text ink black #141312.
Keep a left-aligned text block in the left 40%, vertically centered; the character occupies the right 50%; generous empty paper and safe margins; nothing touching the edges. Preserve a fully opaque warm off-white xuan rice paper (#f3efe6) background with faint, understated long paper fibers. Calm, restrained, museum-quality.
No additional text, no extra seals, no transparent background, no gradients, glossy or 3D effects, splatters, drips, drop shadows, frames, watermarks or props.

