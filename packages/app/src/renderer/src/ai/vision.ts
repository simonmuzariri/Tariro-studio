/**
 * The image AI engine: TensorFlow.js (WebGL) and the bundled MobileNet v2, loaded the first time
 * an AI feature is used, so learners who never use AI never load them.
 */
import type * as TF from '@tensorflow/tfjs-core';
import type { LayersModel } from '@tensorflow/tfjs-layers';

export interface VisionEngine {
  tf: typeof TF;
  /** 1,280 features for what the camera (or a canvas) shows now, from the centre square. */
  embed(source: HTMLVideoElement | HTMLCanvasElement): Float32Array;
  backend: string;
}

let engine: Promise<VisionEngine> | null = null;

export function loadVision(): Promise<VisionEngine> {
  engine ??= (async () => {
    const tf = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-backend-cpu');
    await import('@tensorflow/tfjs-backend-webgl');
    const tfl = await import('@tensorflow/tfjs-layers');
    // WebGL when the graphics card allows it (fast); otherwise the CPU (slower, still works).
    const gpu = await tf.setBackend('webgl').catch(() => false);
    if (!gpu) await tf.setBackend('cpu');
    await tf.ready();
    const net: LayersModel = await tfl.loadLayersModel(new URL('/models/mobilenet/model.json', location.href).href);
    const stats = { backend: tf.getBackend(), lastMs: 0, count: 0 };
    // For end-to-end tests: which backend runs, and how long a picture takes.
    (window as unknown as { __tariroAi?: typeof stats }).__tariroAi = stats;
    const embedNow = (source: HTMLVideoElement | HTMLCanvasElement): Float32Array =>
      tf.tidy(() => {
        const img = tf.browser.fromPixels(source);
        // The centre square, like the preview shows, scaled to the 224 × 224 the network expects.
        const [h, w] = img.shape;
        const side = Math.min(h, w);
        const square = tf.slice(img, [Math.floor((h - side) / 2), Math.floor((w - side) / 2), 0], [side, side, 3]);
        const resized = tf.image.resizeBilinear(square as TF.Tensor3D, [224, 224]);
        const x = tf.expandDims(tf.sub(tf.div(tf.cast(resized, 'float32'), 127.5), 1), 0);
        const features = net.predict(x) as TF.Tensor4D;
        return tf.mean(features, [1, 2]).dataSync() as Float32Array;
      });
    const embed = (source: HTMLVideoElement | HTMLCanvasElement): Float32Array => {
      const t0 = performance.now();
      const out = embedNow(source);
      stats.lastMs = performance.now() - t0;
      stats.count++;
      return out;
    };
    // The first run compiles the network's shaders; do it now so the first picture is not slow.
    const warm = document.createElement('canvas');
    warm.width = warm.height = 224;
    embed(warm);
    return { tf, embed, backend: tf.getBackend() };
  })();
  engine.catch(() => {
    engine = null; // let the learner try again
  });
  return engine;
}

/** A small JPEG of the centre square, to show which pictures a class was taught with. */
export function thumbnail(source: HTMLVideoElement | HTMLCanvasElement, size = 64): string {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const side = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')?.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.7);
}
