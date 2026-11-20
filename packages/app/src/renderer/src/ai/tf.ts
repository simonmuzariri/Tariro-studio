/**
 * TensorFlow.js for the AI tools, loaded the first time one is used: WebGL when the graphics card
 * allows it, otherwise the CPU. The gradients are registered here, so sound and gesture models can
 * be trained without loading the image model.
 */
import type * as TF from '@tensorflow/tfjs-core';

let loading: Promise<typeof TF> | null = null;

export function loadTf(): Promise<typeof TF> {
  loading ??= (async () => {
    const tf = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-core/dist/register_all_gradients');
    await import('@tensorflow/tfjs-backend-cpu');
    await import('@tensorflow/tfjs-backend-webgl');
    const gpu = await tf.setBackend('webgl').catch(() => false);
    if (!gpu) await tf.setBackend('cpu');
    await tf.ready();
    return tf;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
