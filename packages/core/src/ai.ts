/**
 * AI image classifier (Phase 4b), the parts that need no camera: how samples are kept in the
 * project, training, and prediction.
 *
 * Each camera picture is turned into 1,280 features by MobileNet v2 (in the app). Training fits
 * one softmax layer on those features, on this computer; the learner's pictures never leave it.
 * TensorFlow.js is passed in (`tf`), so this file runs in Node tests and in the app alike.
 */
import { z } from 'zod';
import type * as TF from '@tensorflow/tfjs-core';

/** Features per picture (MobileNet v2's last layer, averaged over the image). */
export const EMBEDDING_SIZE = 1280;
export const MAX_CLASSES = 8;
export const MAX_SAMPLES_PER_CLASS = 200;

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const ImageClassSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(40),
  /** Features of each picture, compressed (see encodeEmbedding). */
  samples: z.array(z.string().max(4000)).max(MAX_SAMPLES_PER_CLASS),
  /** A few small pictures to show which images the class was taught with (JPEG data URLs). */
  thumbs: z.array(z.string().max(20_000)).max(12).optional(),
});
export type ImageClass = z.infer<typeof ImageClassSchema>;

export const TrainedModelSchema = z.object({
  /** Class names in output order. */
  classes: z.array(z.string()).min(2).max(MAX_CLASSES),
  /** Float32 weights [EMBEDDING_SIZE × classes] and biases [classes], base64. */
  weights: z.string(),
  bias: z.string(),
  /** Share of held-back pictures named correctly (0–1); null when there were too few to hold back. */
  accuracy: z.number().min(0).max(1).nullable(),
  /** How many pictures it learned from. */
  samples: z.number().int().min(0),
  trainedAt: z.string(),
});
export type TrainedModel = z.infer<typeof TrainedModelSchema>;

export const ImageModelSchema = z.object({
  classes: z.array(ImageClassSchema).max(MAX_CLASSES),
  trained: TrainedModelSchema.optional(),
});
export type ImageModel = z.infer<typeof ImageModelSchema>;

/** A new model: two empty classes, ready for pictures. */
export function newImageModel(): ImageModel {
  return {
    classes: [
      { id: 'class-1', name: 'Class 1', samples: [] },
      { id: 'class-2', name: 'Class 2', samples: [] },
    ],
  };
}

// ───────── compact storage of features ─────────

// Node and every browser have these; core has no DOM types, so name them here.
const { btoa, atob } = globalThis as unknown as { btoa(s: string): string; atob(s: string): string };

const toBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/**
 * One picture's features as 1,284 bytes (base64): a float32 scale, then each feature as 0–255.
 * MobileNet's features are 0 or more (they come after a ReLU), so 8 bits keep them to within
 * 0.2 % of the largest, which does not change what a classifier learns.
 */
export function encodeEmbedding(e: Float32Array): string {
  let max = 0;
  for (const v of e) if (v > max) max = v;
  const scale = max > 0 ? max / 255 : 1;
  const bytes = new Uint8Array(4 + e.length);
  new DataView(bytes.buffer).setFloat32(0, scale, true);
  for (let i = 0; i < e.length; i++) bytes[4 + i] = Math.round(Math.max(0, e[i]!) / scale);
  return toBase64(bytes);
}

export function decodeEmbedding(s: string): Float32Array {
  const bytes = fromBase64(s);
  const scale = new DataView(bytes.buffer, bytes.byteOffset).getFloat32(0, true);
  const out = new Float32Array(bytes.length - 4);
  for (let i = 0; i < out.length; i++) out[i] = bytes[4 + i]! * scale;
  return out;
}

/**
 * Features that can be below zero (sound, body pose) as 8 bits each: the smallest value and the
 * step (two float32), then each feature as 0–255 between the smallest and the largest.
 */
export function encodeFeatures(e: Float32Array): string {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of e) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) lo = hi = 0;
  const step = hi > lo ? (hi - lo) / 255 : 1;
  const bytes = new Uint8Array(8 + e.length);
  const view = new DataView(bytes.buffer);
  view.setFloat32(0, lo, true);
  view.setFloat32(4, step, true);
  for (let i = 0; i < e.length; i++) bytes[8 + i] = Math.round((e[i]! - lo) / step);
  return toBase64(bytes);
}

export function decodeFeatures(s: string): Float32Array {
  const bytes = fromBase64(s);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const lo = view.getFloat32(0, true);
  const step = view.getFloat32(4, true);
  const out = new Float32Array(bytes.length - 8);
  for (let i = 0; i < out.length; i++) out[i] = lo + bytes[8 + i]! * step;
  return out;
}

const floatsToBase64 = (f: Float32Array) => toBase64(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
const base64ToFloats = (s: string) => {
  const b = fromBase64(s);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

// ───────── training ─────────

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  /** Progress after each epoch (0–1) with the training loss. */
  onEpoch?(progress: number, loss: number): void | Promise<void>;
  /** Fixed seed for the held-back split and the starting weights (tests). */
  seed?: number;
  /** How samples are stored: image features (the default) or signed features (sound, pose). */
  decode?: (s: string) => Float32Array;
}

/** Why a model cannot be trained yet (null when it can). `what` names the samples ("pictures", "recordings"). */
export function trainingProblem(model: ImageModel, what = 'pictures'): string | null {
  const ready = model.classes.filter((c) => c.samples.length > 0);
  if (model.classes.length < 2) return 'Add at least two classes.';
  const empty = model.classes.find((c) => c.samples.length === 0);
  if (empty) return `"${empty.name}" has no ${what} yet.`;
  if (ready.some((c) => c.samples.length < 5)) return `Give every class at least 5 ${what}.`;
  const names = model.classes.map((c) => c.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return 'Give every class a different name.';
  return null;
}

/** A small, repeatable random number generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Train the classifier: one softmax layer on the features, with Adam. Every class with at least
 * 10 pictures has a fifth held back; accuracy is measured on those only, so it says how well the
 * model does on pictures it has not seen. The final model then learns from every picture.
 */
export async function trainImageModel(tf: typeof TF, model: ImageModel, opts: TrainOptions = {}): Promise<TrainedModel> {
  const problem = trainingProblem(model);
  if (problem) throw new Error(problem);
  const decode = opts.decode ?? decodeEmbedding;
  const random = rng(opts.seed ?? Date.now());
  const epochs = opts.epochs ?? 60;
  const k = model.classes.length;

  const all: Array<{ x: Float32Array; y: number; test: boolean }> = [];
  model.classes.forEach((c, y) => {
    const xs = c.samples.map(decode);
    const order = xs.map((_, i) => i).sort(() => random() - 0.5);
    const holdOut = c.samples.length >= 10 ? Math.round(c.samples.length / 5) : 0;
    order.forEach((i, n) => all.push({ x: xs[i]!, y, test: n < holdOut }));
  });
  const canTest = all.some((s) => s.test) && model.classes.every((_, y) => all.some((s) => s.test && s.y === y));
  // As many weights as each sample has features (1,280 for a picture; fewer for a sound or a pose).
  const dims = all[0]!.x.length;
  if (all.some((s) => s.x.length !== dims)) throw new Error('The samples were recorded in different ways; clear them and record again.');

  const fit = async (rows: typeof all, report: boolean) => {
    const x = tf.tensor2d(rows.flatMap((r) => [...r.x]), [rows.length, dims]);
    // Features vary in size between pictures; scaling each row to length 1 makes training steadier.
    const xn = tf.tidy(() => tf.div(x, tf.add(tf.norm(x, 'euclidean', 1, true), 1e-6)));
    const y = tf.oneHot(tf.tensor1d(rows.map((r) => r.y), 'int32'), k);
    const w = tf.variable(tf.randomNormal([dims, k], 0, 0.01, 'float32', Math.floor(random() * 1e9)));
    const b = tf.variable(tf.zeros([k]));
    const optimizer = tf.train.adam(opts.learningRate ?? 0.01);
    for (let epoch = 0; epoch < epochs; epoch++) {
      const loss = optimizer.minimize(() => tf.losses.softmaxCrossEntropy(y, tf.add(tf.matMul(xn, w), b)) as TF.Scalar, true);
      if (report && opts.onEpoch) await opts.onEpoch((epoch + 1) / epochs, loss ? (await loss.data())[0]! : 0);
      loss?.dispose();
    }
    const out = { w: (await w.data()) as Float32Array, b: (await b.data()) as Float32Array };
    tf.dispose([x, xn, y, w, b]);
    optimizer.dispose();
    return out;
  };

  let accuracy: number | null = null;
  if (canTest) {
    const trial = await fit(
      all.filter((s) => !s.test),
      false,
    );
    const tests = all.filter((s) => s.test);
    const right = tests.filter((s) => argmax(softmaxScores(trial.w, trial.b, k, s.x)) === s.y).length;
    accuracy = right / tests.length;
  }
  const final = await fit(all, true);
  return {
    classes: model.classes.map((c) => c.name),
    weights: floatsToBase64(final.w),
    bias: floatsToBase64(final.b),
    accuracy,
    samples: all.length,
    trainedAt: new Date().toISOString(),
  };
}

// ───────── prediction (plain JavaScript, fast enough for every camera frame) ─────────

function softmaxScores(w: Float32Array, b: Float32Array, k: number, e: Float32Array): number[] {
  let norm = 0;
  for (const v of e) norm += v * v;
  norm = Math.sqrt(norm) + 1e-6;
  const logits = Array.from({ length: k }, (_, j) => {
    let s = b[j]!;
    for (let i = 0; i < e.length; i++) s += (e[i]! / norm) * w[i * k + j]!;
    return s;
  });
  const m = Math.max(...logits);
  const ex = logits.map((l) => Math.exp(l - m));
  const sum = ex.reduce((a, v) => a + v, 0);
  return ex.map((v) => v / sum);
}
const argmax = (xs: number[]) => xs.reduce((best, v, i) => (v > xs[best]! ? i : best), 0);

export interface Prediction {
  /** The most likely class. */
  label: string;
  /** Its confidence, 0–1. */
  confidence: number;
  /** Every class with its confidence, in the model's order. */
  scores: Array<{ label: string; confidence: number }>;
}

/** A trained model ready to name pictures. */
export function loadClassifier(m: TrainedModel): (embedding: Float32Array) => Prediction {
  const w = base64ToFloats(m.weights);
  const b = base64ToFloats(m.bias);
  const k = m.classes.length;
  return (e) => {
    const p = softmaxScores(w, b, k, e);
    const best = argmax(p);
    return { label: m.classes[best]!, confidence: p[best]!, scores: m.classes.map((label, i) => ({ label, confidence: p[i]! })) };
  };
}
