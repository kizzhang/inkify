<p align="center">
  <img src="assets/logo.png" alt="inkify logo" width="220">
</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# inkify：让字用毛笔写出来

inkify 是一个给 Codex 和 Claude Code 用的 skill，在网页上用毛笔把一个汉字写出来：一笔一笔，按人手的节奏写，墨会写干，停笔处积墨，还会洇进宣纸。墨迹事先离线用一个"毛笔加宣纸"的小模型算好，网页只用普通的 SVG 和 CSS 按时间把它刷出来，首帧就开始写，不需要 JavaScript。

![inkify 顶图](assets/banner.jpg)

<p align="center">
  <img src="assets/demo.gif" alt="inkify 写出的「張」" width="360"><br>
  <sub>inkify 写的「張」，节奏是第 2 遍（<a href="https://kizzhang.com">kizzhang.com</a> 的开场）</sub>
</p>

## 从矢量擦除到笔墨

![同一组轮廓：左边是纯黑矢量填充，右边是 inkify](assets/flat-vs-ink.jpg)

常见的笔顺动画是一支恒宽的遮罩沿中线扫过，再把轮廓填成纯黑（Hanzi Writer、SVG `stroke-dashoffset` 的做法），看起来像剪影。inkify 用的还是同一组轮廓和中线，但多了三样东西：

- **笔**：72 根笔毫，一到五根并成一簇、共用墨量。边上的毫先干；哪根毫剩下的墨压不过纸面的起伏（纸齿），就在哪里跳过去，留下飞白。
- **纸**：九千多根纤维叠在细密的纸纹上。飞白落在哪里、笔画边缘往哪里毛、洇墨顺着纤维渗向哪里，都由这同一张纸决定。
- **手**：一套运动控制的时间模型，包括等时性、三分之二幂律、先升后降的速度、落笔和转折处的停顿，以及部件之间更长的停顿。每一遍都用自己的随机种子带一点变化，所以没有两遍一模一样。墨迹也读这份时间：笔在哪里停，墨就积在哪里。

完整的方法和每一部分依据的研究：[references/method.md](references/method.md) · [references/timing.md](references/timing.md)（英文）。

## 30 秒上手

装进个人 skills 目录（需要 Node 18+）：

```bash
# Codex
git clone https://github.com/kizzhang/inkify.git ~/.codex/skills/inkify
# Claude Code
git clone https://github.com/kizzhang/inkify.git ~/.claude/skills/inkify
```

```powershell
# Windows（PowerShell），Codex
git clone https://github.com/kizzhang/inkify.git "$env:USERPROFILE\.codex\skills\inkify"
```

可选：在目录里运行 `npm install` 装上 `sharp`，墨迹图集会存成 WebP，比 PNG 小三倍左右。

然后对 agent 说：

```text
使用 $inkify 把「永」做成我主页开场的毛笔书写动画，先写三遍给我挑。
```

也可以直接打开 [examples/zhang/out/index.html](examples/zhang/out/index.html)，看一个做好的页面。

## 命令入口

这些命令 agent 会自己运行，你也可以直接用：

```bash
node scripts/inkify.mjs doctor                       # 检查 Node 版本和 WebP 支持
node scripts/inkify.mjs all 永                        # 取笔画 → 时间 → 墨迹 → 页面，输出到 ./inkify-out/永
node scripts/inkify.mjs all 永 --takes 3              # 写三遍，生成 compare.html 用来挑选
node scripts/inkify.mjs all my-strokes.json          # 用你自己的轮廓和中线
node scripts/inkify.mjs render inkify-out/永 --dryness 1.3 --bleed 0.7
```

每一步（`fetch` / `import`、`timing`、`render`、`build`）都在同一个文件夹里读写。所以可以先改 `character.json`（每一笔是出锋还是顿笔、属于哪个部件、快慢），再只重跑受影响的那一步。`node scripts/check.mjs` 是自检。

## 会输出什么

```text
index.html      会自己写字的页面（带"重写"按钮）
writer.html     可以直接贴进你页面的 SVG
inkify.css      关键帧：笔刷、落笔、洇墨、交接、减少动态效果
ink.webp        所有笔画的墨迹图集（约 70–120 KB）
inkify.json     中线、时间和墨迹位置，给你自己的渲染器用
ink-writer.js   inkWriterSVG(data)，生成同样的 SVG，任何框架都能用
preview.png     写完的墨迹，生成页面前先看一眼
```

React 项目可以用 [templates/InkWriter.tsx](templates/InkWriter.tsx)。怎么嵌进网站、预加载图集、保住"首帧就开始写"，见 [references/embedding.md](references/embedding.md)。

## Skill 入口

- agent 的工作流：[SKILL.md](SKILL.md)
- 墨是怎么做出来的，以及参考文献：[references/method.md](references/method.md)
- 时间模型：[references/timing.md](references/timing.md)
- 调参与排错：[references/tuning.md](references/tuning.md)
- 放进网站：[references/embedding.md](references/embedding.md)
- 命令行：[scripts/inkify.mjs](scripts/inkify.mjs)

## 数据与致谢

`fetch` 从 [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 下载笔画数据（源自 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)，Arphic Public License）。这些轮廓来自楷书字体。用真毛笔写一个字、自己描出轮廓，效果会生动得多，`import` 可以直接读入。见 [NOTICE.md](NOTICE.md)。

logo 和顶图由 Codex 的图像生成制作（[提示词](assets/imagegen-prompts.md)），演示动图和对比图由 inkify 自己渲染。

## License

MIT，见 [LICENSE](LICENSE)。
