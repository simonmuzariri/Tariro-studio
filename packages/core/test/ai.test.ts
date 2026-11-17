/**
 * The AI image classifier: storage of features, training and prediction, and the bundled
 * MobileNet itself (run on generated pictures in Node; the app runs it on camera frames).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import * as tfl from '@tensorflow/tfjs-layers';
import {
  decodeEmbedding,
  EMBEDDING_SIZE,
  encodeEmbedding,
  ImageModelSchema,
  loadClassifier,
  newImageModel,
  trainImageModel,
  trainingProblem,
  type ImageModel,
} from '../src/index.js';

beforeAll(async () => {
  await tf.setBackend('cpu');
});

/** A made-up feature vector near one of a few "kinds" of picture. */
function fakeEmbedding(kind: number, random: () => number): Float32Array {
  const e = new Float32Array(EMBEDDING_SIZE);
  for (let i = 0; i < EMBEDDING_SIZE; i++) e[i] = Math.max(0, random() * 0.6 + (i % 3 === kind ? 1.5 : 0) - 0.2);
  return e;
}
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('AI image classifier', () => {
  it('stores each picture in 1,284 bytes, within 0.2 % of the largest feature', () => {
    const e = fakeEmbedding(0, seeded(1));
    const back = decodeEmbedding(encodeEmbedding(e));
    expect(back.length).toBe(EMBEDDING_SIZE);
    const max = Math.max(...e);
    for (let i = 0; i < e.length; i++) expect(Math.abs(back[i]! - e[i]!)).toBeLessThanOrEqual(max / 255 / 2 + 1e-6);
    expect(atob(encodeEmbedding(e)).length).toBe(4 + EMBEDDING_SIZE);
  });

  it('says what is missing before it can train', () => {
    const m = newImageModel();
    expect(trainingProblem(m)).toBe('"Class 1" has no pictures yet.');
    const one = encodeEmbedding(fakeEmbedding(0, seeded(2)));
    m.classes[0]!.samples = Array(5).fill(one);
    m.classes[1]!.samples = Array(3).fill(one);
    expect(trainingProblem(m)).toBe('Give every class at least 5 pictures.');
    m.classes[1]!.samples = Array(5).fill(one);
    m.classes[1]!.name = 'class 1';
    expect(trainingProblem(m)).toBe('Give every class a different name.');
  });

  it('learns three kinds of picture, measures itself on held-back pictures, and names new ones', async () => {
    const r = seeded(7);
    const model: ImageModel = {
      classes: ['Cup', 'Pen', 'Hand'].map((name, k) => ({ id: `c${k}`, name, samples: Array.from({ length: 20 }, () => encodeEmbedding(fakeEmbedding(k, r))) })),
    };
    const progress: number[] = [];
    const trained = await trainImageModel(tf, model, { seed: 3, epochs: 40, onEpoch: (p) => void progress.push(p) });
    expect(progress.at(-1)).toBe(1);
    expect(trained.classes).toEqual(['Cup', 'Pen', 'Hand']);
    expect(trained.samples).toBe(60);
    expect(trained.accuracy).toBeGreaterThanOrEqual(0.9); // 12 held-back pictures
    const classify = loadClassifier(trained);
    for (let k = 0; k < 3; k++) {
      const p = classify(fakeEmbedding(k, r));
      expect(p.label).toBe(['Cup', 'Pen', 'Hand'][k]);
      expect(p.scores.reduce((a, s) => a + s.confidence, 0)).toBeCloseTo(1, 5);
    }
    // The whole thing is saved in the project.
    expect(ImageModelSchema.parse({ ...model, trained }).trained?.classes).toEqual(['Cup', 'Pen', 'Hand']);
  });

  it('with fewer than 10 pictures per class there is nothing to hold back, and it says so', async () => {
    const r = seeded(9);
    const model: ImageModel = { classes: ['A', 'B'].map((name, k) => ({ id: name, name, samples: Array.from({ length: 6 }, () => encodeEmbedding(fakeEmbedding(k, r))) })) };
    expect((await trainImageModel(tf, model, { seed: 1, epochs: 10 })).accuracy).toBeNull();
  });
});

describe('the bundled MobileNet v2 feature extractor', () => {
  const dir = join(import.meta.dirname, '../../app/models/mobilenet-v2-0.35');
  let net: tfl.LayersModel;

  beforeAll(async () => {
    const json = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8')) as { modelTopology: object; weightsManifest: Array<{ weights: tf.io.WeightsManifestEntry[] }> };
    const bin = readFileSync(join(dir, 'group1-shard1of1.bin'));
    net = await tfl.loadLayersModel({
      load: async () => ({
        modelTopology: json.modelTopology,
        weightSpecs: json.weightsManifest.flatMap((g) => g.weights),
        weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
      }),
    });
  }, 60_000);

  /** A 224 × 224 picture: a plain colour, or stripes, with some noise. */
  const picture = (kind: 'red' | 'blue' | 'stripes', seed: number) =>
    tf.tidy(() => {
      const noise = tf.randomUniform([224, 224, 3], -20, 20, 'float32', seed);
      const base =
        kind === 'stripes'
          ? tf.tile(tf.concat([tf.fill([224, 8, 3], 230), tf.fill([224, 8, 3], 20)], 1), [1, 14, 1])
          : tf.mul(tf.ones([224, 224, 3]), tf.tensor1d(kind === 'red' ? [220, 30, 40] : [30, 60, 220]));
      return tf.clipByValue(tf.add(base, noise), 0, 255);
    });

  /** Same preparation as the app: scale to −1…1, run the network, average over the image. */
  const embed = (img: tf.Tensor3D): Float32Array =>
    tf.tidy(() => {
      const x = tf.expandDims(tf.sub(tf.div(img, 127.5), 1), 0);
      const out = net.predict(x) as tf.Tensor4D;
      return tf.mean(out, [1, 2]).dataSync() as Float32Array;
    });

  it('turns a picture into 1,280 features', () => {
    const e = embed(picture('red', 1) as tf.Tensor3D);
    expect(e.length).toBe(EMBEDDING_SIZE);
    expect(Math.max(...e)).toBeGreaterThan(0);
    expect(Math.min(...e)).toBeGreaterThanOrEqual(0);
  });

  it('a classifier trained on its features tells red, blue and striped pictures apart', async () => {
    const kinds = ['red', 'blue', 'stripes'] as const;
    const model: ImageModel = {
      classes: kinds.map((k, i) => ({ id: k, name: k, samples: Array.from({ length: 10 }, (_, n) => encodeEmbedding(embed(picture(k, i * 100 + n) as tf.Tensor3D))) })),
    };
    const trained = await trainImageModel(tf, model, { seed: 5, epochs: 40 });
    expect(trained.accuracy).toBe(1);
    const classify = loadClassifier(trained);
    for (const k of kinds) expect(classify(embed(picture(k, 999) as tf.Tensor3D)).label).toBe(k);
  }, 120_000);
});
