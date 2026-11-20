/**
 * ArUco markers (Phase 4d): printed black-and-white squares a robot can recognise and locate
 * with the camera. Our own detector for the original ArUco markers (Garrido-Jurado et al., 2014):
 * a black border round a 5 × 5 grid; each row is one of four words (two error-checking, two
 * carrying a 2-bit part of the number), so 1,024 markers, numbered 0–1023.
 *
 * Steps: grey picture → dark/light by the local average (copes with uneven light) → dark regions
 * → their four corners → read the 7 × 7 cells through the perspective → border all dark, every row a
 * valid word in one of the four turns → the number, the corners and the middle.
 */
import type { Frame } from './colour.js';

/** The four valid rows; a white cell is 1. Bits 2 and 4 of a row (indices 1 and 3) carry the number. */
const WORDS = [
  [1, 0, 0, 0, 0],
  [1, 0, 1, 1, 1],
  [0, 1, 0, 0, 1],
  [0, 1, 1, 1, 0],
] as const;

export const ARUCO_IDS = 1024;

/** The 5 × 5 inner cells of a marker (1 = white), row by row. */
export function arucoBits(id: number): number[][] {
  if (!Number.isInteger(id) || id < 0 || id >= ARUCO_IDS) throw new Error(`Marker numbers are 0 to ${ARUCO_IDS - 1}.`);
  return [0, 1, 2, 3, 4].map((row) => [...WORDS[(id >> (2 * (4 - row))) & 3]!]);
}

/** A printable marker as SVG: the 7 × 7 marker inside a white margin one cell wide. */
export function arucoSvg(id: number, size = 200): string {
  const bits = arucoBits(id);
  const cell = size / 9;
  let rects = '';
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 7; c++) {
      const inner = r > 0 && r < 6 && c > 0 && c < 6;
      const white = inner && bits[r - 1]![c - 1] === 1;
      if (!white) rects += `<rect x="${(c + 1) * cell}" y="${(r + 1) * cell}" width="${cell + 0.3}" height="${cell + 0.3}"/>`;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

export interface Point {
  x: number;
  y: number;
}
export interface ArucoMarker {
  id: number;
  /** The marker's corners in picture pixels, starting at its top-left and going clockwise. */
  corners: [Point, Point, Point, Point];
  /** Its middle. */
  x: number;
  y: number;
  /** Its size: the average side, in pixels. */
  size: number;
}

// ───────── helpers ─────────

function grey(f: Frame): Uint8Array {
  const g = new Uint8Array(f.width * f.height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (f.data[j]! * 77 + f.data[j + 1]! * 150 + f.data[j + 2]! * 29) >> 8;
  return g;
}

/** Dark (1) where a pixel is darker than its neighbourhood's average by a margin. */
function threshold(g: Uint8Array, w: number, h: number): Uint8Array {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x]!;
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1]! + row;
    }
  }
  const r = Math.max(4, Math.round(Math.min(w, h) / 16));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const area = (x1 - x0) * (y1 - y0);
      const s = sum[y1 * (w + 1) + x1]! - sum[y0 * (w + 1) + x1]! - sum[y1 * (w + 1) + x0]! + sum[y0 * (w + 1) + x0]!;
      out[y * w + x] = g[y * w + x]! < s / area - 7 ? 1 : 0;
    }
  }
  return out;
}

interface Region {
  pixels: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Connected dark regions (4-neighbours) of a useful size. */
function regions(bin: Uint8Array, w: number, h: number): Region[] {
  const seen = new Uint8Array(w * h);
  const out: Region[] = [];
  const stack: number[] = [];
  const minSide = Math.max(12, Math.min(w, h) / 30);
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || seen[start]) continue;
    const reg: Region = { pixels: [], minX: w, minY: h, maxX: 0, maxY: 0 };
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      reg.pixels.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x < reg.minX) reg.minX = x;
      if (x > reg.maxX) reg.maxX = x;
      if (y < reg.minY) reg.minY = y;
      if (y > reg.maxY) reg.maxY = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && bin[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
    }
    const bw = reg.maxX - reg.minX + 1;
    const bh = reg.maxY - reg.minY + 1;
    if (bw >= minSide && bh >= minSide && bw < w * 0.95 && bh < h * 0.95 && reg.pixels.length > bw * bh * 0.15) out.push(reg);
  }
  return out;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (monotone chain) of a region's outline points. */
function hull(reg: Region, w: number): Point[] {
  // Only the leftmost and rightmost pixel of each row are needed for the hull.
  const rows = new Map<number, [number, number]>();
  for (const p of reg.pixels) {
    const x = p % w;
    const y = (p - x) / w;
    const r = rows.get(y);
    if (!r) rows.set(y, [x, x]);
    else {
      if (x < r[0]) r[0] = x;
      if (x > r[1]) r[1] = x;
    }
  }
  const pts: Point[] = [];
  for (const [y, [a, b]] of rows) pts.push({ x: a, y }, { x: b + 1, y }, { x: a, y: y + 1 }, { x: b + 1, y: y + 1 });
  pts.sort((p, q) => p.x - q.x || p.y - q.y);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const area = (poly: Point[]) => Math.abs(poly.reduce((s, p, i) => s + cross({ x: 0, y: 0 }, p, poly[(i + 1) % poly.length]!), 0)) / 2;

/** The four corners of a roughly square hull, clockwise on screen (y down). */
function corners(h: Point[]): [Point, Point, Point, Point] | undefined {
  if (h.length < 4) return undefined;
  const c = { x: h.reduce((s, p) => s + p.x, 0) / h.length, y: h.reduce((s, p) => s + p.y, 0) / h.length };
  const a = h.reduce((best, p) => (dist(p, c) > dist(best, c) ? p : best));
  const b = h.reduce((best, p) => (dist(p, a) > dist(best, a) ? p : best));
  let left: Point | undefined;
  let right: Point | undefined;
  let lMax = 0;
  let rMax = 0;
  for (const p of h) {
    const d = cross(a, b, p);
    if (d > lMax) {
      lMax = d;
      left = p;
    }
    if (-d > rMax) {
      rMax = -d;
      right = p;
    }
  }
  if (!left || !right) return undefined;
  const quad: [Point, Point, Point, Point] = [a, left, b, right];
  // Clockwise on screen (y grows downwards): the signed area is positive.
  const signed = quad.reduce((s, p, i) => s + cross({ x: 0, y: 0 }, p, quad[(i + 1) % 4]!), 0);
  if (signed < 0) quad.reverse();
  return quad;
}

/** The perspective map from the unit square (0..1 × 0..1) to a quadrilateral. */
function homography(q: [Point, Point, Point, Point]): (u: number, v: number) => Point {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den ? (sx * dy2 - dx2 * sy) / den : 0;
  const hh = den ? (dx1 * sy - sx * dy1) / den : 0;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + hh * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + hh * p3.y;
  return (u, v) => {
    const z = g * u + hh * v + 1;
    return { x: (a * u + b * v + p0.x) / z, y: (d * u + e * v + p0.y) / z };
  };
}

const rotate = (m: number[][]): number[][] => m[0]!.map((_, c) => m.map((row) => row[c]!).reverse());

function decode(inner: number[][]): number | undefined {
  let id = 0;
  for (const row of inner) {
    const word = WORDS.findIndex((w) => w.every((b, i) => b === row[i]));
    if (word < 0) return undefined;
    id = (id << 2) | word;
  }
  return id;
}

/** Every ArUco marker in the picture. */
export function findArucoMarkers(frame: Frame): ArucoMarker[] {
  const { width: w, height: h } = frame;
  const g = grey(frame);
  const bin = threshold(g, w, h);
  const found = new Map<number, ArucoMarker>();
  for (const reg of regions(bin, w, h)) {
    const hu = hull(reg, w);
    const q = corners(hu);
    if (!q) continue;
    // Square enough: the four corners cover most of the region's outline, and no side is tiny.
    const sides = q.map((p, i) => dist(p, q[(i + 1) % 4]!));
    if (Math.min(...sides) < 10 || Math.max(...sides) / Math.min(...sides) > 3.5 || area(q) < area(hu) * 0.85) continue;
    const map = homography(q);
    // The 7 × 7 cells: the average grey near each cell's middle.
    const cells: number[][] = [];
    for (let r = 0; r < 7; r++) {
      const row: number[] = [];
      for (let c = 0; c < 7; c++) {
        let s = 0;
        let n = 0;
        for (const du of [-0.2, 0, 0.2])
          for (const dv of [-0.2, 0, 0.2]) {
            const p = map((c + 0.5 + du) / 7, (r + 0.5 + dv) / 7);
            const x = Math.round(p.x);
            const y = Math.round(p.y);
            if (x >= 0 && y >= 0 && x < w && y < h) {
              s += g[y * w + x]!;
              n++;
            }
          }
        row.push(n ? s / n : 0);
      }
      cells.push(row);
    }
    const flat = cells.flat();
    const lo = Math.min(...flat);
    const hi = Math.max(...flat);
    if (hi - lo < 40) continue; // no contrast: not a marker
    const mid = (lo + hi) / 2;
    const bits = cells.map((row) => row.map((v) => (v > mid ? 1 : 0)));
    if (bits.some((row, r) => row.some((b, c) => (r === 0 || r === 6 || c === 0 || c === 6) && b === 1))) continue;
    let inner: number[][] = bits.slice(1, 6).map((row) => row.slice(1, 6));
    let quad = q;
    for (let turn = 0; turn < 4; turn++) {
      const id = decode(inner);
      if (id !== undefined) {
        const size = (sides[0]! + sides[1]! + sides[2]! + sides[3]!) / 4;
        const prev = found.get(id);
        if (!prev || prev.size < size) found.set(id, { id, corners: quad, x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4, y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4, size });
        break;
      }
      // Turn the cells a quarter clockwise; the marker's top-left corner moves to the next corner.
      inner = rotate(inner);
      quad = [quad[3], quad[0], quad[1], quad[2]];
    }
  }
  return [...found.values()].sort((a, b) => a.id - b.id);
}
