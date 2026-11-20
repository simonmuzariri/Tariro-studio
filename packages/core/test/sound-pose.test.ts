/** Phase 4f: sound fingerprints (and a sound classifier trained on them), body pose and gesture features. */
import { beforeAll, describe, expect, it } from 'vitest';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
// Training needs the gradients (the app registers them too).
import '@tensorflow/tfjs-core/dist/register_all_gradients';
import {
  bandEnergies,
  decodeFeatures,
  decodeSinglePose,
  encodeFeatures,
  loadClassifier,
  loudness,
  melFilters,
  POSE_POINTS,
  poseFeatures,
  SOUND_FEATURES,
  soundFingerprint,
  trainImageModel,
  type ImageModel,
} from '../src/index.js';

beforeAll(async () => {
  await tf.setBackend('cpu');
});

const RATE = 44100;
const BINS = 512;
const filters = melFilters(BINS, RATE);

/** A spectrum (dB per bin) of a tone at `hz` (with a quieter octave) over a noise floor, `level` dB loud. */
function spectrum(hz: number, level: number, seed: number): Float32Array {
  const s = new Float32Array(BINS);
  let r = seed;
  const binHz = RATE / 2 / BINS;
  for (let k = 0; k < BINS; k++) {
    r = (r * 16807) % 2147483647;
    s[k] = -100 + (r % 10);
    const f = k * binHz;
    for (const [h, gain] of [
      [hz, 0],
      [hz * 2, -12],
    ] as const)
      if (Math.abs(f - h) < binHz * 1.5) s[k] = level + gain;
  }
  return s;
}
const second = (hz: number, level: number, seed: number) => Array.from({ length: 40 }, (_, i) => bandEnergies(spectrum(hz, level, seed + i), filters));

describe('sound fingerprints', () => {
  it('fingerprints a second of sound in 96 numbers; a quieter sound stays close, another sound does not', () => {
    const near = soundFingerprint(second(440, -20, 1));
    const far = soundFingerprint(second(440, -40, 1));
    expect(near).toHaveLength(SOUND_FEATURES);
    // Same tone, 20 dB quieter (further from the microphone): still much closer than a different sound.
    const gap = (a: Float32Array, b: Float32Array) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / SOUND_FEATURES;
    const high = soundFingerprint(second(3000, -20, 1));
    expect(gap(near, high)).toBeGreaterThan(gap(near, far) * 2);
    expect(loudness(bandEnergies(spectrum(440, -20, 3), filters))).toBeGreaterThan(loudness(bandEnergies(spectrum(440, -60, 3), filters)));
  });

  it('stores signed features compactly and gets them back closely', () => {
    const f = soundFingerprint(second(1000, -30, 5));
    const back = decodeFeatures(encodeFeatures(f));
    const range = Math.max(...f) - Math.min(...f);
    for (let i = 0; i < f.length; i++) expect(Math.abs(back[i]! - f[i]!)).toBeLessThanOrEqual(range / 255 + 1e-5);
  });

  it('a sound classifier learns a low hum from a whistle, on this computer', async () => {
    const samples = (hz: number, seed: number) => Array.from({ length: 12 }, (_, i) => encodeFeatures(soundFingerprint(second(hz * (1 + (i - 6) * 0.01), -25 - (i % 4) * 5, seed + i * 50))));
    const model: ImageModel = {
      classes: [
        { id: 'hum', name: 'Hum', samples: samples(150, 11) },
        { id: 'whistle', name: 'Whistle', samples: samples(2500, 900) },
      ],
    };
    const trained = await trainImageModel(tf, model, { decode: decodeFeatures, seed: 3, epochs: 80 });
    expect(trained.accuracy).toBe(1);
    const classify = loadClassifier(trained);
    expect(classify(soundFingerprint(second(160, -35, 4444))).label).toBe('Hum');
    expect(classify(soundFingerprint(second(2400, -30, 5555))).label).toBe('Whistle');
  });
});

describe('body pose', () => {
  it('reads each body point from the heatmap peak plus its offset', () => {
    const rows = 9;
    const cols = 9;
    const n = POSE_POINTS.length;
    const heat = new Float32Array(rows * cols * n).fill(-5);
    const off = new Float32Array(rows * cols * n * 2);
    // The nose near grid point (2, 4), 3 px lower and 5 px to the right of it; the left wrist at (7, 1).
    heat[(2 * cols + 4) * n + 0] = 4;
    off[(2 * cols + 4) * n * 2 + 0] = 3;
    off[(2 * cols + 4) * n * 2 + n + 0] = 5;
    heat[(7 * cols + 1) * n + 9] = 2;
    const pose = decodeSinglePose(heat, off, rows, cols, 16, 2, 2);
    expect(pose.points[0]).toMatchObject({ name: 'nose', x: (4 * 16 + 5) * 2, y: (2 * 16 + 3) * 2 });
    expect(pose.points[0]!.score).toBeGreaterThan(0.95);
    expect(pose.points[9]).toMatchObject({ name: 'left wrist', x: 16 * 2, y: 7 * 16 * 2 });
    expect(pose.points[5]!.score).toBeLessThan(0.1); // nothing found there
  });

  it('describes a gesture the same wherever the learner stands and however far away', () => {
    const body = (dx: number, dy: number, scale: number, wristUp: boolean) => ({
      score: 0.9,
      points: POSE_POINTS.map((name) => {
        const base: Record<string, [number, number]> = {
          'left shoulder': [120, 100],
          'right shoulder': [80, 100],
          'left wrist': wristUp ? [130, 40] : [130, 170],
          'right wrist': [70, 170],
          nose: [100, 70],
        };
        const p = base[name];
        return p ? { name, x: dx + p[0] * scale, y: dy + p[1] * scale, score: 0.9 } : { name, x: 0, y: 0, score: 0.1 };
      }),
    });
    const a = poseFeatures(body(0, 0, 1, true));
    const b = poseFeatures(body(60, 25, 0.5, true));
    const down = poseFeatures(body(0, 0, 1, false));
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i]!, 5);
    const leftWristY = POSE_POINTS.indexOf('left wrist') * 2 + 1;
    expect(a[leftWristY]).toBeLessThan(0); // above the shoulders
    expect(down[leftWristY]).toBeGreaterThan(0);
  });
});
