/**
 * Sound recognition (Phase 4f), the part that needs no microphone: a sound's fingerprint, made
 * from the microphone's spectrum (the app's Web Audio analyser gives one every ~25 ms). No model to
 * download: the classifier learns straight from these fingerprints, on this computer.
 *
 * A fingerprint is one second of sound: 24 bands spaced like human hearing (mel scale, 100 Hz to
 * 8 kHz), averaged in four quarter-second slices, so it holds both the pitch and how the sound
 * changes. The bands are relative to the second's average level, so a sound further from the
 * microphone stays close to the same sound nearby (the background noise still shows more).
 */

export const SOUND_BANDS = 24;
export const SOUND_SLICES = 4;
/** Values per fingerprint. */
export const SOUND_FEATURES = SOUND_BANDS * SOUND_SLICES;

const mel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const hzOf = (m: number) => 700 * (10 ** (m / 2595) - 1);

/** Triangular mel filters over the spectrum's bins: for each band, [bin, weight] pairs. */
export function melFilters(bins: number, sampleRate: number, bands = SOUND_BANDS, lowHz = 100, highHz = 8000): Array<Array<[number, number]>> {
  const nyquist = sampleRate / 2;
  const hi = Math.min(highHz, nyquist);
  const edges = Array.from({ length: bands + 2 }, (_, i) => hzOf(mel(lowHz) + ((mel(hi) - mel(lowHz)) * i) / (bands + 1)));
  const binHz = nyquist / bins;
  return Array.from({ length: bands }, (_, b) => {
    const [lo, mid, top] = [edges[b]!, edges[b + 1]!, edges[b + 2]!];
    const out: Array<[number, number]> = [];
    for (let k = Math.floor(lo / binHz); k <= Math.ceil(top / binHz) && k < bins; k++) {
      const f = k * binHz;
      const w = f < mid ? (f - lo) / (mid - lo) : (top - f) / (top - mid);
      if (w > 0) out.push([k, w]);
    }
    return out;
  });
}

/** One spectrum (decibels per bin, as AnalyserNode.getFloatFrequencyData gives) → band energies (dB). */
export function bandEnergies(spectrumDb: ArrayLike<number>, filters: Array<Array<[number, number]>>): Float32Array {
  const out = new Float32Array(filters.length);
  filters.forEach((f, b) => {
    let e = 0;
    let wsum = 0;
    for (const [k, w] of f) {
      const db = spectrumDb[k]!;
      e += w * 10 ** ((Number.isFinite(db) ? db : -140) / 10);
      wsum += w;
    }
    out[b] = 10 * Math.log10(e / Math.max(wsum, 1e-9) + 1e-12);
  });
  return out;
}

/**
 * About a second of band energies (oldest first) → the sound's fingerprint: four slices of band
 * averages, each made relative to the whole second's average level.
 */
export function soundFingerprint(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(SOUND_FEATURES);
  if (!frames.length) return out;
  let mean = 0;
  for (const f of frames) for (const v of f) mean += v;
  mean /= frames.length * SOUND_BANDS;
  for (let s = 0; s < SOUND_SLICES; s++) {
    const from = Math.floor((s * frames.length) / SOUND_SLICES);
    const to = Math.max(from + 1, Math.floor(((s + 1) * frames.length) / SOUND_SLICES));
    const slice = frames.slice(from, to);
    for (let b = 0; b < SOUND_BANDS; b++) {
      let v = 0;
      for (const f of slice) v += f[b]!;
      // Relative level, in tens of dB, so the numbers stay small.
      out[s * SOUND_BANDS + b] = (v / slice.length - mean) / 10;
    }
  }
  return out;
}

/** How loud a spectrum is, 0–100 (silence near 0, shouting near 100). */
export function loudness(bands: Float32Array): number {
  let max = -Infinity;
  for (const v of bands) if (v > max) max = v;
  return Math.max(0, Math.min(100, Math.round(((max + 100) / 70) * 100)));
}
