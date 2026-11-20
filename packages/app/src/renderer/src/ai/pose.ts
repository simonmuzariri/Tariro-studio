/**
 * Body pose with PoseNet (MobileNet 0.75, bundled in the app at /models/posenet/, Apache-2.0):
 * 17 body points in a camera picture, found on this computer.
 */
import type * as TF from '@tensorflow/tfjs-core';
import type { GraphModel } from '@tensorflow/tfjs-converter';
import { decodeSinglePose, type Pose } from '@tariro-studio/core';
import { loadTf } from './tf';

/** PoseNet's input: a size of 16·n + 1 pixels each way (here 4:3, like most cameras). */
const IN_W = 321;
const IN_H = 241;
const STRIDE = 16;

export interface PoseEngine {
  /** One person's body points, in the source's pixels. */
  estimate(source: HTMLVideoElement | HTMLCanvasElement): Pose;
}

let loading: Promise<PoseEngine> | null = null;

export function loadPose(): Promise<PoseEngine> {
  loading ??= (async () => {
    const tf = await loadTf();
    const { loadGraphModel } = await import('@tensorflow/tfjs-converter');
    const model: GraphModel = await loadGraphModel(new URL('/models/posenet/model.json', location.href).href);
    const estimate = (source: HTMLVideoElement | HTMLCanvasElement): Pose => {
      const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
      const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
      const [heat, off] = tf.tidy(() => {
        const img = tf.image.resizeBilinear(tf.browser.fromPixels(source), [IN_H, IN_W]);
        const x = tf.expandDims(tf.sub(tf.div(tf.cast(img, 'float32'), 127.5), 1), 0);
        const out = model.execute(x, ['MobilenetV1/heatmap_2/BiasAdd', 'MobilenetV1/offset_2/BiasAdd']) as TF.Tensor4D[];
        return [tf.squeeze(out[0]!, [0]) as TF.Tensor3D, tf.squeeze(out[1]!, [0]) as TF.Tensor3D];
      });
      const [rows, cols] = heat.shape;
      const pose = decodeSinglePose(heat.dataSync(), off.dataSync(), rows, cols, STRIDE, w / IN_W, h / IN_H);
      tf.dispose([heat, off]);
      return pose;
    };
    // The first run compiles the shaders; do it now.
    const warm = document.createElement('canvas');
    warm.width = IN_W;
    warm.height = IN_H;
    estimate(warm);
    return { estimate };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
