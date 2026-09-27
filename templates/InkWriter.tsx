// A React component that writes an inkify character. Copy it into your project with inkify.json, the
// atlas image (ink.webp) and inkify.css (or paste its rules into your global CSS).
//
//   import data from './inkify.json';
//   <InkWriter data={data} className="w-[min(70vmin,560px)]" />
//
// Works with server rendering: the writing is plain SVG plus CSS animations, so it starts with the first
// paint of the HTML, before React hydrates. Put the atlas where data.atlas.href points (or pass `atlasHref`),
// and preload it: <link rel="preload" as="image" href="/ink.webp" fetchpriority="high">.
import React from 'react';

export interface InkTexture {
  x: number;
  y: number;
  width: number;
  height: number;
  cell: [number, number, number, number];
  tile: [number, number, number, number];
}

export interface InkifyData {
  char: string;
  viewBox: string;
  brushWidth: number;
  atlas: { href: string; width: number; height: number };
  writtenAt: number;
  strokes: {
    id: string;
    trace: string;
    timing: { delay: number; duration: number; easing: string; dash: number; from: number };
    ink: { main: InkTexture; rest: InkTexture | null; restWidth: number; halo: InkTexture | null; haloWidth: number };
  }[];
}

const REST_LAG_MS = 40;
const BLEED_LAG_MS = 90;
const BLEED_MS = 700;
const LAND_WIDTH = 0.3;
const PRESS_OVERRUN_MS = 60;
const LAYERS = ['halo', 'rest', 'main'] as const;

/** How long the brush rests where it lands: the first flat run of the stroke's easing. */
function landingMs(timing: InkifyData['strokes'][number]['timing']) {
  const points = timing.easing.slice(timing.easing.indexOf('(') + 1, timing.easing.lastIndexOf(')')).split(',')
    .map((p) => p.trim().split(/\s+/)).filter((p) => p.length === 2)
    .map(([y, x]) => [parseFloat(y), parseFloat(x)]);
  let k = 0;
  while (k + 1 < points.length && points[k + 1][0] === points[0][0]) k++;
  return ((points[k][1] - points[0][1]) / 100) * timing.duration;
}

type Atlas = InkifyData['atlas'];

/** A texture: the atlas, cropped to the texture's cell and placed where the texture goes. */
const Ink: React.FC<{ texture: InkTexture; atlas: Atlas; className?: string; style?: React.CSSProperties }> = ({ texture, atlas, className, style }) => {
  const [x, y, width, height] = texture.cell;
  return (
    <svg className={className} style={style} x={texture.x} y={texture.y} width={texture.width} height={texture.height} viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="none">
      <image href={atlas.href} width={atlas.width} height={atlas.height} />
    </svg>
  );
};

/** A texture as a paint for a brush: its tile is only as big as the brush can reach. */
const InkPattern: React.FC<{ id: string; texture: InkTexture; atlas: Atlas }> = ({ id, texture, atlas }) => {
  const [tx, ty, tw, th] = texture.tile;
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" x={tx} y={ty} width={tw} height={th} viewBox={`${tx} ${ty} ${tw} ${th}`}>
      <Ink texture={texture} atlas={atlas} />
    </pattern>
  );
};

type CssAnimation = { name: string; delay: number; ms: number; easing: string; fill: string };

function animationStyle(animations: CssAnimation[]): React.CSSProperties {
  return {
    animationName: animations.map((a) => a.name).join(', '),
    animationDelay: animations.map((a) => `${a.delay}ms`).join(', '),
    animationDuration: animations.map((a) => `${a.ms}ms`).join(', '),
    animationTimingFunction: animations.map((a) => a.easing).join(', '),
    animationFillMode: animations.map((a) => a.fill).join(', '),
  };
}

/**
 * The character written stroke by stroke in ink. Each stroke is a brush moving along its centerline whose
 * paint is that stroke's rendered ink; the brush lands on its tip and presses down, the ink beyond its reach
 * fills in just behind it, and the ink bleeds into the paper after that. The moment a brush finishes it
 * hands over to a plain image of the same ink, so no pattern bitmap stays alive once written.
 */
const InkWriter: React.FC<{ data: InkifyData; className?: string; offset?: number; atlasHref?: string; title?: string }> = ({ data, className = '', offset = 0, atlasHref, title }) => {
  const atlas = atlasHref ? { ...data.atlas, href: atlasHref } : data.atlas;
  const prefix = `ink-${[...data.char].map((c) => c.codePointAt(0)!.toString(16)).join('')}`;
  return (
    <svg viewBox={data.viewBox} role="img" aria-label={title ?? `${data.char}, written with a brush`} className={className} style={{ overflow: 'visible', willChange: 'transform' }}>
      <defs>
        {data.strokes.flatMap((stroke, i) => LAYERS.map((layer) => {
          const texture = stroke.ink[layer];
          return texture && <InkPattern key={`${i}-${layer}`} id={`${prefix}-${i + 1}-${layer}`} texture={texture} atlas={atlas} />;
        }))}
      </defs>
      {data.strokes.map((stroke, i) => {
        const timing = { ...stroke.timing, delay: stroke.timing.delay + offset };
        const press = { name: 'ink-press', ms: Math.round(landingMs(timing) + PRESS_OVERRUN_MS), easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' };
        const bleed = { name: 'ink-bleed', ms: BLEED_MS, easing: 'ease-out' };
        const layer = (name: (typeof LAYERS)[number], width: number, lag: number, second: typeof press, done: number) => {
          const texture = stroke.ink[name];
          if (!texture) return null;
          const start = timing.delay + lag;
          return (
            <React.Fragment key={name}>
              <Ink texture={texture} atlas={atlas} className="ink-still" style={{ animationDelay: `${done}ms` }} />
              <path
                className="ink-brush"
                d={stroke.trace}
                stroke={`url(#${prefix}-${i + 1}-${name})`}
                strokeWidth={width}
                style={{
                  strokeDasharray: `${timing.dash} ${2 * timing.dash}`,
                  '--ink-from': timing.from,
                  '--ink-land': width * LAND_WIDTH,
                  ...animationStyle([
                    { name: 'ink-write', delay: start, ms: timing.duration, easing: timing.easing, fill: 'backwards' },
                    { ...second, delay: start, fill: 'backwards' },
                    { name: 'ink-done', delay: done, ms: 1, easing: 'linear', fill: 'forwards' },
                  ]),
                } as React.CSSProperties}
              />
            </React.Fragment>
          );
        };
        return (
          <g key={stroke.id}>
            {layer('halo', stroke.ink.haloWidth, BLEED_LAG_MS, bleed, timing.delay + BLEED_LAG_MS + Math.max(timing.duration, BLEED_MS))}
            {layer('rest', stroke.ink.restWidth, REST_LAG_MS, press, timing.delay + REST_LAG_MS + timing.duration)}
            {layer('main', data.brushWidth, 0, press, timing.delay + timing.duration)}
          </g>
        );
      })}
    </svg>
  );
};

export default InkWriter;
