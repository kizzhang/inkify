# Notices

## Character data

`fetch` downloads stroke outlines and median lines from [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data),
which is derived from [Make Me a Hanzi](https://github.com/skishore/makemeahanzi). Their glyph data comes from
fonts by Arphic Technology and is distributed under the
[Arphic Public License](https://github.com/skishore/makemeahanzi/tree/master/APL). inkify does not
bundle that data; it is fetched when you run `fetch`, and what you build from it is subject to that license.

The example character in `examples/zhang` (張) is the author's own stroke data from the kizzhang.com intro, released with this
repository under the MIT License.

## Artwork

`assets/logo.png` and `assets/banner.jpg` were generated with Codex's built-in image generation; the prompts are
in [assets/imagegen-prompts.md](assets/imagegen-prompts.md). `assets/demo.gif` and `assets/flat-vs-ink.jpg` are
rendered by inkify itself.
