/**
 * Body pose and gestures (Phase 4f), the parts that need no model: turning PoseNet's output into
 * 17 named body points, and a pose into features a gesture classifier can learn from.
 *
 * PoseNet (in the app) looks at the picture and gives, every 16 pixels, how likely each body point
 * is there (a heatmap) and how far the exact spot is from that grid point (offsets).
 */

export const POSE_POINTS = [
  'nose',
  'left eye',
  'right eye',
  'left ear',
  'right ear',
  'left shoulder',
  'right shoulder',
  'left elbow',
  'right elbow',
  'left wrist',
  'right wrist',
  'left hip',
  'right hip',
  'left knee',
  'right knee',
  'left ankle',
  'right ankle',
] as const;
export type PosePointName = (typeof POSE_POINTS)[number];

export interface PosePoint {
  name: PosePointName;
  /** In picture pixels. */
  x: number;
  y: number;
  /** How sure PoseNet is, 0–1. */
  score: number;
}
export interface Pose {
  points: PosePoint[];
  /** The average certainty of the points: a body is "seen" above about 0.3. */
  score: number;
}

/** A point counts as found above this certainty. */
export const POINT_SCORE = 0.3;

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));

/**
 * One person's pose from PoseNet's outputs: `heatmap` [rows × cols × 17] and `offsets`
 * [rows × cols × 34] (17 y offsets, then 17 x offsets), every `stride` pixels of the model's input;
 * `scaleX`/`scaleY` take the model's input pixels back to the picture's.
 */
export function decodeSinglePose(heatmap: ArrayLike<number>, offsets: ArrayLike<number>, rows: number, cols: number, stride: number, scaleX = 1, scaleY = 1): Pose {
  const n = POSE_POINTS.length;
  const points: PosePoint[] = POSE_POINTS.map((name, k) => {
    let best = -Infinity;
    let br = 0;
    let bc = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const v = heatmap[(r * cols + c) * n + k]!;
        if (v > best) {
          best = v;
          br = r;
          bc = c;
        }
      }
    const o = (br * cols + bc) * n * 2;
    const y = br * stride + offsets[o + k]!;
    const x = bc * stride + offsets[o + n + k]!;
    return { name, x: x * scaleX, y: y * scaleY, score: sigmoid(best) };
  });
  return { points, score: points.reduce((s, p) => s + p.score, 0) / n };
}

/**
 * A pose as numbers a classifier can learn from: every point relative to the middle of the
 * shoulders, in shoulder widths, so a gesture means the same wherever the learner stands and
 * however far from the camera. Points PoseNet is not sure of count as 0.
 */
export function poseFeatures(pose: Pose): Float32Array {
  const at = (name: PosePointName) => pose.points.find((p) => p.name === name)!;
  const l = at('left shoulder');
  const r = at('right shoulder');
  const cx = (l.x + r.x) / 2;
  const cy = (l.y + r.y) / 2;
  const unit = Math.max(Math.hypot(l.x - r.x, l.y - r.y), 1);
  const out = new Float32Array(POSE_POINTS.length * 2);
  pose.points.forEach((p, i) => {
    if (p.score < POINT_SCORE) return;
    out[i * 2] = (p.x - cx) / unit;
    out[i * 2 + 1] = (p.y - cy) / unit;
  });
  return out;
}
