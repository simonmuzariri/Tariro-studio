/**
 * Waveform measurements for the virtual oscilloscope and logic view: a recording is a list of
 * (time, value) points where the value holds until the next point, as the simulator's outputs do.
 */

export interface Sample {
  /** Milliseconds since the recording started. */
  t: number;
  /** Volts. */
  v: number;
}

export interface WaveStats {
  min: number;
  max: number;
  /** Time-weighted average, volts. */
  mean: number;
  /** Repetitions per second, from rising edges through the midpoint; undefined if fewer than two edges. */
  frequency?: number;
  /** Share of each period spent above the midpoint, 0…1; undefined without a frequency. */
  duty?: number;
}

/** Statistics over the samples from `from` to `to` (ms). Values hold between samples. */
export function waveStats(samples: Sample[], from: number, to: number): WaveStats | undefined {
  const inWindow = samples.filter((s) => s.t <= to);
  if (inWindow.length === 0 || to <= from) return undefined;
  // The value at `from` is the last sample at or before it.
  const startIdx = Math.max(0, inWindow.findIndex((s) => s.t > from) - 1);
  const pts = inWindow.slice(startIdx === -1 ? inWindow.length - 1 : startIdx);
  let min = Infinity;
  let max = -Infinity;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = Math.max(pts[i]!.t, from);
    const b = Math.min(i + 1 < pts.length ? pts[i + 1]!.t : to, to);
    if (b <= a && pts.length > 1) continue;
    min = Math.min(min, pts[i]!.v);
    max = Math.max(max, pts[i]!.v);
    area += pts[i]!.v * Math.max(b - a, 0);
  }
  const stats: WaveStats = { min, max, mean: area / (to - from) };
  if (max - min < 0.5) return stats;

  const mid = (min + max) / 2;
  const rises: number[] = [];
  let highTime = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1]!.v <= mid && pts[i]!.v > mid && pts[i]!.t >= from) rises.push(pts[i]!.t);
  }
  if (rises.length >= 2) {
    const first = rises[0]!;
    const last = rises[rises.length - 1]!;
    const periods = rises.length - 1;
    stats.frequency = (periods * 1000) / (last - first);
    // Time above the midpoint between the first and last rising edge.
    for (let i = 0; i < pts.length; i++) {
      const a = Math.max(pts[i]!.t, first);
      const b = Math.min(i + 1 < pts.length ? pts[i + 1]!.t : last, last);
      if (b > a && pts[i]!.v > mid) highTime += b - a;
    }
    stats.duty = highTime / (last - first);
  }
  return stats;
}

/** Engineering format: 0.0123 → "12.3 m", 4700 → "4.7 k". */
export function siPrefix(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return `OL ${unit}`.trim();
  const abs = Math.abs(value);
  const [scale, prefix] = abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'k'] : abs >= 1 || abs === 0 ? [1, ''] : abs >= 1e-3 ? [1e-3, 'm'] : [1e-6, 'µ'];
  return `${+(value / scale).toPrecision(digits)} ${prefix}${unit}`;
}
