/** Phase 4d: colour detection and ArUco markers, on pictures drawn in the test. */
import { describe, expect, it } from 'vitest';
import { qrMatrix } from './fixtures/qr-encode.js';
import { arucoBits, arucoSvg, colourOf, findArucoMarkers, findColours, findQrCode, type Frame } from '../src/index.js';

const W = 320;
const H = 240;

/** A light-grey picture with a little noise, like a camera's. */
function blank(seed = 1): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  for (let i = 0; i < W * H; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = (s % 13) - 6;
    data[i * 4] = 200 + n;
    data[i * 4 + 1] = 202 + n;
    data[i * 4 + 2] = 198 + n;
    data[i * 4 + 3] = 255;
  }
  return { width: W, height: H, data };
}

const put = (f: Frame, x: number, y: number, rgb: [number, number, number]) => {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return;
  const i = (Math.floor(y) * f.width + Math.floor(x)) * 4;
  f.data[i] = rgb[0];
  f.data[i + 1] = rgb[1];
  f.data[i + 2] = rgb[2];
};

/**
 * Draw marker `id` (with its white margin) centred at (cx, cy), `side` pixels across, turned by
 * `angle` degrees, optionally squashed by `tilt` (0–1) to look at it slightly from the side.
 */
function drawMarker(f: Frame, id: number, cx: number, cy: number, side: number, angle = 0, tilt = 0) {
  const bits = arucoBits(id);
  const a = (angle * Math.PI) / 180;
  const half = (side / 2) * (9 / 7);
  for (let y = Math.floor(cy - half * 1.6); y < cy + half * 1.6; y++)
    for (let x = Math.floor(cx - half * 1.6); x < cx + half * 1.6; x++) {
      // Back from the picture to the marker's own square (−1..1 with the margin).
      let dx = x - cx;
      const dy = y - cy;
      // Perspective-like squash: the further down, the narrower.
      dx /= 1 - tilt * (dy / half) * 0.5;
      const u = (dx * Math.cos(a) + dy * Math.sin(a)) / half;
      const v = (-dx * Math.sin(a) + dy * Math.cos(a)) / half;
      if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
      const c = Math.floor(((u + 1) / 2) * 9);
      const r = Math.floor(((v + 1) / 2) * 9);
      const inMarker = c >= 1 && c <= 7 && r >= 1 && r <= 7;
      const inner = c >= 2 && c <= 6 && r >= 2 && r <= 6;
      const white = !inMarker || (inner && bits[r - 2]![c - 2] === 1);
      put(f, x, y, white ? [238, 238, 236] : [22, 22, 26]);
    }
}

describe('ArUco markers', () => {
  it('reads markers of any number, size and turn', () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 120],
      [7, 30, 100],
      [513, 90, 80],
      [1023, 200, 110],
      [42, 315, 64],
    ];
    for (const [id, angle, side] of cases) {
      const f = blank(id + 3);
      drawMarker(f, id, 160, 120, side, angle);
      const found = findArucoMarkers(f);
      expect(found.map((m) => m.id), `marker ${id} at ${angle}°`).toEqual([id]);
      expect(found[0]!.x).toBeCloseTo(160, -1);
      expect(found[0]!.y).toBeCloseTo(120, -1);
    }
  });

  it('reads several markers in one picture, and one seen a little from the side', () => {
    const f = blank(9);
    drawMarker(f, 5, 80, 110, 70, 10);
    drawMarker(f, 300, 235, 120, 80, -20, 0.25);
    const found = findArucoMarkers(f);
    expect(found.map((m) => m.id)).toEqual([5, 300]);
    expect(found[0]!.x).toBeLessThan(found[1]!.x);
  });

  it('sees nothing in an empty picture or a plain black square', () => {
    expect(findArucoMarkers(blank(4))).toEqual([]);
    const f = blank(5);
    for (let y = 70; y < 170; y++) for (let x = 110; x < 210; x++) put(f, x, y, [20, 20, 20]);
    expect(findArucoMarkers(f)).toEqual([]);
  });

  it('prints a marker as SVG, and refuses numbers that do not exist', () => {
    expect(arucoSvg(12)).toMatch(/^<svg[^>]+viewBox="0 0 200 200"/);
    expect(() => arucoBits(1024)).toThrow(/0 to 1023/);
  });
});

describe('colours', () => {
  it('names colours by hue, strength and brightness', () => {
    expect(colourOf(220, 30, 30)).toBe('red');
    expect(colourOf(240, 140, 20)).toBe('orange');
    expect(colourOf(230, 220, 40)).toBe('yellow');
    expect(colourOf(40, 180, 60)).toBe('green');
    expect(colourOf(30, 80, 220)).toBe('blue');
    expect(colourOf(130, 50, 200)).toBe('purple');
    expect(colourOf(240, 90, 180)).toBe('pink');
    expect(colourOf(250, 250, 248)).toBe('white');
    expect(colourOf(15, 15, 18)).toBe('black');
    expect(colourOf(128, 128, 128)).toBeUndefined(); // grey is not a colour
  });

  it('finds where a coloured card is, and how big', () => {
    const f = blank(2);
    for (let y = 40; y < 100; y++) for (let x = 200; x < 260; x++) put(f, x, y, [30, 90, 215]);
    const found = findColours(f);
    expect(found.blue.seen).toBe(true);
    expect(found.blue.x).toBeCloseTo(229, -1);
    expect(found.blue.y).toBeCloseTo(69, -1);
    expect(found.blue.area).toBeCloseTo((60 * 60) / (W * H), 2);
    expect(found.blue.box.width).toBeGreaterThan(45);
    expect(found.red.seen).toBe(false);
    expect(found.white.seen).toBe(false); // the light-grey background is not white
  });
});

describe('QR codes', () => {
  it('reads the text of a QR code in the picture', () => {
    const f = blank(7);
    const m = qrMatrix('Tariro robot 42');
    const scale = 6;
    const left = 160 - (33 * scale) / 2;
    const top = 120 - (33 * scale) / 2;
    for (let y = 0; y < 33 * scale; y++)
      for (let x = 0; x < 33 * scale; x++) {
        const mx = Math.floor(x / scale) - 4;
        const my = Math.floor(y / scale) - 4;
        const dark = mx >= 0 && my >= 0 && mx < 25 && my < 25 && m[my]![mx];
        put(f, left + x, top + y, dark ? [20, 20, 20] : [245, 245, 245]);
      }
    const qr = findQrCode(f);
    expect(qr?.text).toBe('Tariro robot 42');
    expect(qr!.x).toBeCloseTo(160, -1);
    expect(findQrCode(blank(8))).toBeUndefined();
  });
});
