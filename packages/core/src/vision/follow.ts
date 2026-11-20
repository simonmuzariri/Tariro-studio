/**
 * Colour following (Phase 5c): how fast each wheel should turn to drive towards a coloured thing
 * the camera sees. Meant for a camera on the robot, looking forward: something to the right of
 * the picture's middle makes the left wheel faster, so the robot turns towards it.
 */

export interface FollowTarget {
  seen: boolean;
  /** Left–right position in the picture, 0 (left edge) to 1 (right edge). */
  x: number;
  /** Share of the picture it fills, 0–1 (bigger when it is closer). */
  area: number;
}

export type FollowState = 'steering' | 'lost' | 'arrived';

export interface FollowStep {
  state: FollowState;
  /** Forward speed of each wheel, 0–100 %. Both 0 when lost or arrived. */
  left: number;
  right: number;
}

/** How strongly it turns: at the picture's edge one wheel stops and the other runs at twice the speed (capped at 100 %). */
export const FOLLOW_GAIN = 1;

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/**
 * One step of following: stop when the colour is not seen (lost) or fills at least
 * `stopAtPercent` of the picture (arrived); otherwise drive at `speed` %, steering towards it.
 */
export function followStep(target: FollowTarget | undefined, speed: number, stopAtPercent: number, gain = FOLLOW_GAIN): FollowStep {
  if (!target?.seen) return { state: 'lost', left: 0, right: 0 };
  if (target.area * 100 >= stopAtPercent) return { state: 'arrived', left: 0, right: 0 };
  const s = clamp(speed);
  // −1 at the left edge, 0 in the middle, 1 at the right edge.
  const offset = Math.min(1, Math.max(-1, (target.x - 0.5) * 2));
  return { state: 'steering', left: Math.round(clamp(s * (1 + gain * offset))), right: Math.round(clamp(s * (1 - gain * offset))) };
}
