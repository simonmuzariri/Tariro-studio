/**
 * Colour detection (Phase 4d): where a colour is in a camera picture, for following a ball or
 * reading a coloured card. Plain JavaScript on the picture's pixels (no model, no download).
 *
 * A pixel counts as a colour by its hue, how strong the colour is (saturation) and how bright it
 * is (value). The result is where the matching pixels are (their middle and the box round most of
 * them) and how much of the picture they cover.
 */

/** A camera picture: RGBA bytes, row by row (as a canvas gives them). */
export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export const COLOUR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'black'] as const;
export type ColourName = (typeof COLOUR_NAMES)[number];

interface Rule {
  /** Hue range in degrees (from > to wraps round 360). */
  hue?: [number, number];
  minS?: number;
  maxS?: number;
  minV?: number;
  maxV?: number;
}

const RULES: Record<ColourName, Rule> = {
  red: { hue: [345, 15], minS: 0.45, minV: 0.25 },
  orange: { hue: [15, 40], minS: 0.5, minV: 0.35 },
  yellow: { hue: [40, 70], minS: 0.4, minV: 0.4 },
  green: { hue: [70, 165], minS: 0.35, minV: 0.2 },
  blue: { hue: [185, 250], minS: 0.4, minV: 0.2 },
  purple: { hue: [250, 295], minS: 0.3, minV: 0.2 },
  pink: { hue: [295, 345], minS: 0.3, minV: 0.35 },
  white: { maxS: 0.15, minV: 0.85 },
  black: { maxV: 0.18 },
};

export interface ColourFound {
  colour: ColourName;
  /** At least this share of the picture (0.5 %) has the colour. */
  seen: boolean;
  /** Share of the picture with the colour, 0–1. */
  area: number;
  /** The middle of the coloured pixels, in picture pixels. */
  x: number;
  y: number;
  /** The box round the middle 90 % of them, in picture pixels. */
  box: { x: number; y: number; width: number; height: number };
}

/** The smallest share of the picture that counts as seeing the colour. */
export const MIN_COLOUR_AREA = 0.005;

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max / 255];
}

function matches(rule: Rule, h: number, s: number, v: number): boolean {
  if (rule.minS !== undefined && s < rule.minS) return false;
  if (rule.maxS !== undefined && s > rule.maxS) return false;
  if (rule.minV !== undefined && v < rule.minV) return false;
  if (rule.maxV !== undefined && v > rule.maxV) return false;
  if (rule.hue) {
    const [from, to] = rule.hue;
    return from <= to ? h >= from && h < to : h >= from || h < to;
  }
  return true;
}

/** The name of the colour of one pixel, or undefined (a dull or in-between colour). */
export function colourOf(r: number, g: number, b: number): ColourName | undefined {
  const [h, s, v] = hsv(r, g, b);
  // Black and white first: their hue means nothing.
  if (matches(RULES.black, h, s, v)) return 'black';
  if (matches(RULES.white, h, s, v)) return 'white';
  return COLOUR_NAMES.find((c) => c !== 'black' && c !== 'white' && matches(RULES[c], h, s, v));
}

/**
 * Find every colour at once (looking at every `step`-th pixel each way: 2 keeps it fast on a camera
 * picture and loses nothing a learner would hold up).
 */
export function findColours(frame: Frame, step = 2): Record<ColourName, ColourFound> {
  const xs: Record<string, number[]> = {};
  const ys: Record<string, number[]> = {};
  for (const c of COLOUR_NAMES) {
    xs[c] = [];
    ys[c] = [];
  }
  let total = 0;
  const { width, height, data } = frame;
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      total++;
      const c = colourOf(data[i]!, data[i + 1]!, data[i + 2]!);
      if (c) {
        xs[c]!.push(x);
        ys[c]!.push(y);
      }
    }
  const out = {} as Record<ColourName, ColourFound>;
  for (const c of COLOUR_NAMES) {
    const px = xs[c]!;
    const py = ys[c]!;
    const area = total ? px.length / total : 0;
    if (!px.length) {
      out[c] = { colour: c, seen: false, area: 0, x: width / 2, y: height / 2, box: { x: 0, y: 0, width: 0, height: 0 } };
      continue;
    }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const pct = (v: number[], p: number) => {
      const sorted = [...v].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    };
    const x0 = pct(px, 0.05);
    const x1 = pct(px, 0.95);
    const y0 = pct(py, 0.05);
    const y1 = pct(py, 0.95);
    out[c] = { colour: c, seen: area >= MIN_COLOUR_AREA, area, x: mean(px), y: mean(py), box: { x: x0, y: y0, width: x1 - x0 + step, height: y1 - y0 + step } };
  }
  return out;
}
