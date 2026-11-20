/** Phase 5c: the colour-following block on the stage drives the Tariro's motor blocks. */
import { describe, expect, it, vi } from 'vitest';
import { getBoard, type StageBoardHandler } from '@tariro-studio/core';
import { stageBoardHandlers, type StageBoardIO } from '@tariro-studio/extensions';

// The AI session's camera, microphone and models need a browser; these tests give it detections directly.
vi.mock('../src/renderer/src/ai/camera', () => ({ camera: {} }));
vi.mock('../src/renderer/src/ai/detect', () => ({ Detectors: class {} }));
vi.mock('../src/renderer/src/ai/microphone', () => ({ microphone: { snapshot: { level: 0 } } }));
vi.mock('../src/renderer/src/ai/vision', () => ({ loadVision: () => Promise.reject(new Error('no vision in tests')) }));
// Loaded by a computed path: the renderer's code is type-checked with the DOM types, not this test project's.
const aiSessionPath = '../src/renderer/src/creative/aiSession.js';
const { aiStageHandlers } = (await import(/* @vite-ignore */ aiSessionPath)) as {
  aiStageHandlers(session: () => unknown, motors: { run?: StageBoardHandler | undefined; stop?: StageBoardHandler | undefined }): Record<string, StageBoardHandler>;
};

const tariro = getBoard('tariro');
const pins = tariro.onboard!.find((p) => p.kind === 'dual-motor-driver')!.pins;

function setup(red: { seen: boolean; x: number; area: number } | null, at = performance.now()) {
  const log: string[] = [];
  const io: StageBoardIO = {
    digitalWrite: (p, on) => void log.push(`${p}=${on ? 1 : 0}`),
    analogWrite: (p, v) => void log.push(`${p}~${v}`),
    servoWrite: () => {},
    digitalRead: () => false,
    analogRead: () => 0,
  };
  const board = stageBoardHandlers(io, tariro);
  const session = { detectors: { latest: { at, colours: red ? { red: { ...red, y: 0.5 } } : {}, markers: [], qr: null, pose: null } } };
  const ai = aiStageHandlers(() => session as never, { run: board['tariro_motor_run'], stop: board['tariro_motor_stop'] });
  const follow = ai['ai_colour_follow']!;
  const step = () => {
    if (follow.kind !== 'statement') throw new Error('not a statement');
    follow.run({ field: () => 'red', number: (n) => (n === 'SPEED' ? 40 : 25) });
  };
  return { log, step };
}

describe('colour following on the stage', () => {
  it('steers the motors towards a red card on the right', () => {
    const { log, step } = setup({ seen: true, x: 0.75, area: 0.05 });
    step();
    // 60 % and 20 % forward: PWM 153 on the left motor (A), 51 on the right (B).
    expect(log).toEqual([`${pins['INA']}=1`, `${pins['ENA']}~153`, `${pins['INB']}=1`, `${pins['ENB']}~51`]);
  });

  it('stops the motors when the card is close, lost, or the camera has stopped answering', () => {
    for (const [red, at] of [
      [{ seen: true, x: 0.5, area: 0.4 }, performance.now()],
      [null, performance.now()],
      [{ seen: true, x: 0.5, area: 0.05 }, performance.now() - 5000],
    ] as const) {
      const { log, step } = setup(red, at);
      step();
      expect(log).toEqual([`${pins['ENA']}~0`, `${pins['ENB']}~0`]);
    }
  });
});
