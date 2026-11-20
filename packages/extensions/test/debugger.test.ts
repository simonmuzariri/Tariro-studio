/** Phase 8c: the block debugger in the live interpreter (the same on the simulator and a real board). */
import { describe, expect, it } from 'vitest';
import { getBoard, LiveRun, type LiveBoard, type PauseReason, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry } from '../src/index.js';
import { block, forever, n, program, set, v, workspace } from '../src/build.js';

const registry = createRegistry();
const uno = getBoard('arduino-uno');

function rig() {
  const log: string[] = [];
  const pauses: Array<[string, PauseReason]> = [];
  let resumes = 0;
  let clock = 0;
  const io: LiveBoard = {
    digitalWrite: async (pin, on) => void log.push(`${pin}=${on ? 1 : 0}`),
    analogWrite: async (pin, value) => void log.push(`${pin}~${value}`),
    servoWrite: async () => {},
    digitalRead: async (pin) => pin === 2,
    analogRead: async (ch) => 300 + ch,
    analogPin: async (ch) => 14 + ch,
  };
  const printed: string[] = [];
  const run = (ws: WorkspaceJson) =>
    new LiveRun(ws, uno, registry, {
      io,
      sleep: async (ms) => {
        clock += ms;
        await new Promise((res) => setImmediate(res));
      },
      now: () => clock,
      print: (text) => void printed.push(text),
      onPause: (id, reason) => void pauses.push([id, reason]),
      onResume: () => void resumes++,
    });
  return { log, pauses, printed, run, resumes: () => resumes, advance: (ms: number) => (clock += ms) };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((res) => setImmediate(res));
  expect(cond()).toBe(true);
};

/** count = 0; forever { count = count + 1; pin 13 HIGH; read pin 2; read A0 } */
const counter = () =>
  workspace(
    [
      program(
        set('c', n(0)),
        forever(
          set('c', block('math_arithmetic', { fields: { OP: 'ADD' }, inputs: { A: v('c'), B: n(1) } })),
          block('io_digital_write', { id: 'led', fields: { PIN: '13', STATE: 'HIGH' } }),
          block('variables_set', { id: 'read', fields: { VAR: { id: 'b' } }, inputs: { VALUE: block('io_digital_read', { fields: { PIN: '2', PULL: 'INPUT_PULLUP' } }) } }),
          block('variables_set', { id: 'level', fields: { VAR: { id: 'a' } }, inputs: { VALUE: block('io_analog_read', { fields: { PIN: 'A0' } }) } }),
        ),
      ),
    ],
    [
      { id: 'c', name: 'count' },
      { id: 'b', name: 'button' },
      { id: 'a', name: 'level' },
    ],
  );

describe('debugger', () => {
  it('stops at a breakpoint each time round, showing the variables and the pins', async () => {
    const r = rig();
    const live = r.run(counter());
    live.setBreakpoints(['led']);
    const done = live.run();
    await until(() => live.pausedAt !== undefined);
    expect(live.pausedAt).toEqual({ blockId: 'led', reason: 'breakpoint' });
    expect(r.pauses).toEqual([['led', 'breakpoint']]);
    // Stopped before the LED block: count is 1, nothing written yet.
    expect(live.variables()).toEqual([
      { name: 'count', value: 1, local: false },
      { name: 'button', value: undefined, local: false },
      { name: 'level', value: undefined, local: false },
    ]);
    expect(r.log).toEqual([]);

    live.resume();
    await until(() => r.pauses.length === 2);
    expect(live.variables().map((x) => [x.name, x.value])).toEqual([
      ['count', 2],
      ['button', true],
      ['level', 300],
    ]);
    // The pin watch: what was written and read, sensor readings included.
    expect([...live.pinWatch.values()].map(({ pin, mode, value }) => [pin, mode, value])).toEqual([
      [13, 'output', 1],
      [2, 'input_pullup', 1],
      [14, 'analog', 300],
    ]);
    expect(r.resumes()).toBe(1);
    live.stop();
    expect((await done).outcome).toBe('stopped');
  });

  it('steps one block at a time, into a loop body', async () => {
    const r = rig();
    const live = r.run(counter());
    live.setBreakpoints(['led']);
    const done = live.run();
    await until(() => live.pausedAt?.blockId === 'led');
    live.step();
    await until(() => live.pausedAt?.blockId === 'read');
    expect(live.pausedAt).toEqual({ blockId: 'read', reason: 'step' });
    expect(r.log).toEqual(['13=1']); // the LED block ran, the read has not
    live.step();
    await until(() => live.pausedAt?.blockId === 'level');
    live.setBreakpoints([]);
    live.resume();
    await until(() => r.log.length >= 3);
    expect(live.pausedAt).toBeUndefined();
    live.stop();
    expect((await done).outcome).toBe('stopped');
  });

  it('pauses on request, and time spent paused does not count as program time', async () => {
    const r = rig();
    const ws = workspace([program(block('tariro_wait_ms', { inputs: { MS: n(100) } }), block('serial_print', { id: 'print', fields: { MODE: 'println' }, inputs: { VALUE: block('tariro_millis') } }))]);
    const live = r.run(ws);
    live.pause();
    const done = live.run();
    await until(() => live.pausedAt !== undefined);
    expect(live.pausedAt!.reason).toBe('pause');
    r.advance(5000); // the learner looks for five seconds
    live.resume();
    expect((await done).outcome).toBe('finished');
    expect(Number(r.printed.join('').trim())).toBeGreaterThanOrEqual(100);
    expect(Number(r.printed.join('').trim())).toBeLessThan(1000);
  });
});
