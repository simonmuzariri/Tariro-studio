/** Phase 5c: colour following, the steering. */
import { describe, expect, it } from 'vitest';
import { followStep } from '../src/index.js';

describe('colour following', () => {
  it('drives straight at a colour in the middle, and turns towards one at the side', () => {
    expect(followStep({ seen: true, x: 0.5, area: 0.05 }, 40, 25)).toEqual({ state: 'steering', left: 40, right: 40 });
    // To the right: the left wheel speeds up, the right slows down.
    const right = followStep({ seen: true, x: 0.75, area: 0.05 }, 40, 25);
    expect(right).toEqual({ state: 'steering', left: 60, right: 20 });
    const left = followStep({ seen: true, x: 0.25, area: 0.05 }, 40, 25);
    expect(left).toEqual({ state: 'steering', left: 20, right: 60 });
    // At the edge one wheel stops; speeds never leave 0–100 %.
    expect(followStep({ seen: true, x: 1, area: 0.05 }, 80, 25)).toEqual({ state: 'steering', left: 100, right: 0 });
    expect(followStep({ seen: true, x: 0.5, area: 0.05 }, 250, 25)).toMatchObject({ left: 100, right: 100 });
  });

  it('stops when the colour is lost or close enough', () => {
    expect(followStep(undefined, 40, 25)).toEqual({ state: 'lost', left: 0, right: 0 });
    expect(followStep({ seen: false, x: 0.5, area: 0.001 }, 40, 25)).toEqual({ state: 'lost', left: 0, right: 0 });
    expect(followStep({ seen: true, x: 0.5, area: 0.3 }, 40, 25)).toEqual({ state: 'arrived', left: 0, right: 0 });
  });
});
