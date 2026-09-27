// Rasterizing outlines (anti-aliased, nonzero winding) and writing images without dependencies.
// WebP output uses `sharp` when it is installed; PNG always works.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { polygons } from './path.mjs';

/**
 * Coverage (0..1) of a filled path over a pixel region. The path is in viewBox units; a pixel is 1/scale
 * of a unit, and the region starts at pixel (rx, ry) and is rw × rh pixels. Exact horizontally, `ss`
 * sub-rows vertically.
 */
export function rasterizePath(d, scale, rx, ry, rw, rh, ss = 5) {
  const edges = [];
  for (const poly of polygons(d, 32)) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const x0 = ax * scale - rx, y0 = ay * scale - ry, x1 = bx * scale - rx, y1 = by * scale - ry;
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? { ya: y0, yb: y1, xa: x0, slope: (x1 - x0) / (y1 - y0), dir: 1 } : { ya: y1, yb: y0, xa: x1, slope: (x0 - x1) / (y0 - y1), dir: -1 });
    }
  }
  const cover = new Float32Array(rw * rh);
  const weight = 1 / ss;
  const xs = [];
  for (let row = 0; row < rh; row++) {
    for (let k = 0; k < ss; k++) {
      const y = row + (k + 0.5) / ss;
      xs.length = 0;
      for (const e of edges) if (y >= e.ya && y < e.yb) xs.push([e.xa + (y - e.ya) * e.slope, e.dir]);
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      for (let j = 0; j + 1 < xs.length; j++) {
        winding += xs[j][1];
        if (!winding) continue;
        const xa = Math.max(0, xs[j][0]), xb = Math.min(rw, xs[j + 1][0]);
        if (xb <= xa) continue;
        const base = row * rw;
        let px = Math.floor(xa);
        const last = Math.min(rw - 1, Math.floor(xb));
        for (; px <= last; px++) {
          const overlap = Math.min(xb, px + 1) - Math.max(xa, px);
          if (overlap > 0) cover[base + px] += overlap * weight;
        }
      }
    }
  }
  for (let i = 0; i < cover.length; i++) if (cover[i] > 1) cover[i] = 1;
  return cover;
}

// ---------- PNG ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA (8-bit) or RGB pixels as a PNG, choosing each row's filter by the smallest sum of residuals. */
export function encodePNG(pixels, width, height, channels = 4) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  const prev = Buffer.alloc(stride);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y ? pixels.subarray((y - 1) * stride, y * stride) : prev;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels] : 0, b = up[i], c = i >= channels ? up[i - channels] : 0;
        let v;
        if (f === 0) v = cur[i];
        else if (f === 1) v = cur[i] - a;
        else if (f === 2) v = cur[i] - b;
        else if (f === 3) v = cur[i] - ((a + b) >> 1);
        else {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        v &= 0xff;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- sharp (optional) ----------

let sharpModule;
/** `sharp` if it can be loaded (from the skill's own node_modules or the working directory), else null. */
export async function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;
  sharpModule = null;
  for (const base of [import.meta.url, `file://${process.cwd().replace(/\\/g, '/')}/`]) {
    try {
      const require = createRequire(base);
      sharpModule = require('sharp');
      break;
    } catch { /* try the next place */ }
  }
  return sharpModule;
}

/**
 * Writes RGBA pixels to `file`: WebP (with sharp) when the name ends in .webp, otherwise PNG.
 * Returns the path actually written, which is .png when WebP was asked for but sharp is missing.
 */
export async function writeImage(file, rgba, width, height, { quality = 82, alphaQuality = 90 } = {}) {
  if (file.endsWith('.webp')) {
    const sharp = await loadSharp();
    if (sharp) {
      await sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ quality, alphaQuality, effort: 6 }).toFile(file);
      return file;
    }
    file = file.replace(/\.webp$/, '.png');
  }
  fs.writeFileSync(file, encodePNG(rgba, width, height, 4));
  return file;
}
