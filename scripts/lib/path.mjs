// SVG path geometry: parsing to cubic Béziers, sampling, flattening and affine transforms.
// Supports M L H V C S Q T Z (absolute and relative); arcs (A) are not supported.

export function tokenize(d) {
  return d.match(/[MmLlHhVvCcSsQqTtZzAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
}

/** The path as subpaths of absolute cubic segments [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]. */
export function subpaths(d) {
  const tokens = tokenize(d);
  const out = [];
  let segs = null;
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lastC = null, lastQ = null;
  const num = () => {
    const v = parseFloat(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`Bad number in path near "${tokens.slice(Math.max(0, i - 4), i + 2).join(' ')}"`);
    return v;
  };
  const open = () => { if (!segs) { segs = []; out.push(segs); } };
  const line = (nx, ny) => {
    open();
    segs.push([[x, y], [x + (nx - x) / 3, y + (ny - y) / 3], [x + (2 * (nx - x)) / 3, y + (2 * (ny - y)) / 3], [nx, ny]]);
    x = nx; y = ny;
  };
  const quad = (cx, cy, nx, ny) => {
    open();
    segs.push([[x, y], [x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y)], [nx + (2 / 3) * (cx - nx), ny + (2 / 3) * (cy - ny)], [nx, ny]]);
    x = nx; y = ny;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        x = ox + num(); y = oy + num(); sx = x; sy = y; segs = null; lastC = lastQ = null;
        cmd = rel ? 'l' : 'L';
        break;
      case 'L': line(ox + num(), oy + num()); lastC = lastQ = null; break;
      case 'H': line(ox + num(), y); lastC = lastQ = null; break;
      case 'V': line(x, oy + num()); lastC = lastQ = null; break;
      case 'C': {
        const c1 = [ox + num(), oy + num()], c2 = [ox + num(), oy + num()], p = [ox + num(), oy + num()];
        open(); segs.push([[x, y], c1, c2, p]); lastC = c2; lastQ = null; [x, y] = p;
        break;
      }
      case 'S': {
        const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const c2 = [ox + num(), oy + num()], p = [ox + num(), oy + num()];
        open(); segs.push([[x, y], c1, c2, p]); lastC = c2; lastQ = null; [x, y] = p;
        break;
      }
      case 'Q': {
        const c = [ox + num(), oy + num()], p = [ox + num(), oy + num()];
        quad(c[0], c[1], p[0], p[1]); lastQ = c; lastC = null;
        break;
      }
      case 'T': {
        const c = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const p = [ox + num(), oy + num()];
        quad(c[0], c[1], p[0], p[1]); lastQ = c; lastC = null;
        break;
      }
      case 'Z':
        if (segs && (x !== sx || y !== sy)) line(sx, sy);
        x = sx; y = sy; segs = null; lastC = lastQ = null;
        break;
      case 'A': throw new Error('Arc commands (A) are not supported; convert arcs to curves first.');
      default: throw new Error(`Unsupported path command ${cmd} in ${d.slice(0, 40)}…`);
    }
  }
  return out.filter((s) => s.length);
}

/** All cubic segments of the path, subpaths concatenated. */
export const cubics = (d) => subpaths(d).flat();

export const bez = (s, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * s[0][k] + 3 * u * u * t * s[1][k] + 3 * u * t * t * s[2][k] + t * t * t * s[3][k]);
};
export const bez1 = (s, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => 3 * u * u * (s[1][k] - s[0][k]) + 6 * u * t * (s[2][k] - s[1][k]) + 3 * t * t * (s[3][k] - s[2][k]));
};
export const bez2 = (s, t) => [0, 1].map((k) => 6 * (1 - t) * (s[2][k] - 2 * s[1][k] + s[0][k]) + 6 * t * (s[3][k] - 2 * s[2][k] + s[1][k]));

/** Each subpath flattened to a closed polygon of [x, y] points. */
export function polygons(d, perSegment = 24) {
  return subpaths(d).map((segs) => {
    const pts = [];
    for (const seg of segs) for (let j = 0; j < perSegment; j++) pts.push(bez(seg, j / perSegment));
    return pts;
  });
}

/** Even-odd point-in-polygon over all subpaths. */
export function insidePolygons(polys, x, y) {
  let hit = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** Bounding box [x0, y0, x1, y1] of a path's flattened outline. */
export function bounds(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polygons(d, 16)) for (const [x, y] of poly) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

const fmt = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** The path with every point mapped through `f([x, y])`, written as absolute M/C/Z commands. */
export function transformPath(d, f, closed = null) {
  const parts = [];
  for (const segs of subpaths(d)) {
    const p0 = f(segs[0][0]);
    parts.push(`M${fmt(p0[0])} ${fmt(p0[1])}`);
    for (const s of segs) {
      const [c1, c2, p] = [f(s[1]), f(s[2]), f(s[3])];
      parts.push(`C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p[0])} ${fmt(p[1])}`);
    }
    const first = segs[0][0], last = segs[segs.length - 1][3];
    const isClosed = closed ?? (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6);
    if (isClosed) parts.push('Z');
  }
  return parts.join('');
}

/**
 * A smooth path through `points` (a stroke's median line), as a Catmull-Rom spline written in cubics.
 * Where the line turns sharply (a 折), the spline keeps a corner rounded to `cornerRadius`, so the brush
 * turns there and the timing model sees the turn as a rest point.
 */
export function smoothPath(points, { cornerAngle = 55, cornerRadius = 2.5 } = {}) {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-6);
  if (pts.length < 2) throw new Error('A trace needs at least two distinct points');
  if (pts.length === 2) return `M${fmt(pts[0][0])} ${fmt(pts[0][1])}L${fmt(pts[1][0])} ${fmt(pts[1][1])}`;
  const sharp = pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return false;
    const a = [p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]], b = [pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]];
    const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
    return Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI) > cornerAngle;
  });
  // Split at sharp points; each run is smoothed on its own and the runs meet at a small rounded corner.
  const runs = [];
  let run = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    run.push(pts[i]);
    if (sharp[i]) { runs.push(run); run = [pts[i]]; }
  }
  runs.push(run);
  const segments = []; // cubic segments
  for (const r of runs) {
    for (let i = 0; i + 1 < r.length; i++) {
      const p0 = r[Math.max(0, i - 1)], p1 = r[i], p2 = r[i + 1], p3 = r[Math.min(r.length - 1, i + 2)];
      // Centripetal-ish tangents, scaled down near run ends so a straight run stays straight.
      const t1 = i === 0 ? [(p2[0] - p1[0]) / 3, (p2[1] - p1[1]) / 3] : [(p2[0] - p0[0]) / 6, (p2[1] - p0[1]) / 6];
      const t2 = i + 2 >= r.length ? [(p2[0] - p1[0]) / 3, (p2[1] - p1[1]) / 3] : [(p3[0] - p1[0]) / 6, (p3[1] - p1[1]) / 6];
      segments.push([p1, [p1[0] + t1[0], p1[1] + t1[1]], [p2[0] - t2[0], p2[1] - t2[1]], p2]);
    }
  }
  // Round each corner where two runs meet: pull both neighbouring segments back by up to cornerRadius and
  // bridge them with a quadratic-like cubic through the corner's control point.
  const out = [];
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    const next = segments[k + 1];
    if (next && seg[3] === next[0] && isCornerJoin(seg, next)) {
      const len1 = Math.hypot(seg[3][0] - seg[0][0], seg[3][1] - seg[0][1]);
      const len2 = Math.hypot(next[3][0] - next[0][0], next[3][1] - next[0][1]);
      const r = Math.min(cornerRadius, len1 / 3, len2 / 3);
      const c = seg[3];
      const d1 = unit([c[0] - seg[2][0], c[1] - seg[2][1]]), d2 = unit([next[1][0] - c[0], next[1][1] - c[1]]);
      const a = [c[0] - d1[0] * r, c[1] - d1[1] * r], b = [c[0] + d2[0] * r, c[1] + d2[1] * r];
      out.push(trimEnd(seg, a));
      out.push([a, [a[0] + (c[0] - a[0]) * (2 / 3), a[1] + (c[1] - a[1]) * (2 / 3)], [b[0] + (c[0] - b[0]) * (2 / 3), b[1] + (c[1] - b[1]) * (2 / 3)], b]);
      segments[k + 1] = trimStart(next, b);
    } else {
      out.push(seg);
    }
  }
  const parts = [`M${fmt(out[0][0][0])} ${fmt(out[0][0][1])}`];
  for (const s of out) parts.push(`C${fmt(s[1][0])} ${fmt(s[1][1])} ${fmt(s[2][0])} ${fmt(s[2][1])} ${fmt(s[3][0])} ${fmt(s[3][1])}`);
  return parts.join('');
}

const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

function isCornerJoin(a, b) {
  const d1 = unit([a[3][0] - a[2][0], a[3][1] - a[2][1]]), d2 = unit([b[1][0] - b[0][0], b[1][1] - b[0][1]]);
  return d1[0] * d2[0] + d1[1] * d2[1] < Math.cos((55 * Math.PI) / 180);
}

/** The segment with its end moved to `p` (keeping the start and the direction of its controls). */
function trimEnd(s, p) {
  return [s[0], s[1], [p[0] + (s[2][0] - s[3][0]), p[1] + (s[2][1] - s[3][1])], p];
}
function trimStart(s, p) {
  return [p, [p[0] + (s[1][0] - s[0][0]), p[1] + (s[1][1] - s[0][1])], s[2], s[3]];
}

/** Dense samples along a path: position, cumulative arc length and curvature (clamped to 1/unit). */
export function sample(d, perSegment = 240) {
  const pts = [];
  let len = 0, prev = null;
  for (const seg of cubics(d)) {
    for (let j = pts.length ? 1 : 0; j <= perSegment; j++) {
      const t = j / perSegment;
      const p = bez(seg, t), d1 = bez1(seg, t), d2 = bez2(seg, t);
      const speed = Math.hypot(d1[0], d1[1]);
      const kappa = speed < 1e-6 ? 0 : Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / speed ** 3;
      if (prev) len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      pts.push({ x: p[0], y: p[1], s: len, kappa: Math.min(kappa, 1) });
      prev = p;
    }
  }
  return { pts, length: len };
}
