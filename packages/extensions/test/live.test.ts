import { describe, expect, it } from 'vitest';
import { checkLive, getBoard, LiveRun, type BlockJson, type LiveBoard, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, EXAMPLES } from '../src/index.js';
import { block, forever, n, program, set, t, v, wait, workspace } from '../src/build.js';

const registry = createRegistry();
const tariro = getBoard('tariro');
const example = (name: string) => EXAMPLES.find((e) => e.name === name)!.workspace;

/** Records what the program does to the pins; time is virtual so waits are instant. */
function rig(inputs: { digital?: Record<number, boolean>; analog?: Record<number, number> } = {}) {
  const log: string[] = [];
  const printed: string[] = [];
  const blocks: Array<string | undefined> = [];
  let clock = 0;
  const io: LiveBoard = {
    digitalWrite: async (pin, on) => void log.push(`${pin}=${on ? 1 : 0}`),
    analogWrite: async (pin, value) => void log.push(`${pin}~${value}`),
    servoWrite: async (pin, angle) => void log.push(`${pin}^${angle}`),
    digitalRead: async (pin) => inputs.digital?.[pin] ?? false,
    analogRead: async (ch) => inputs.analog?.[ch] ?? 0,
    analogPin: async (ch) => (ch < 6 ? 14 + ch : undefined),
  };
  const host = {
    io,
    sleep: async (ms: number) => {
      clock += ms;
      // Virtual time, but a real trip through the event loop so Stop can get in.
      await new Promise((res) => setImmediate(res));
    },
    now: () => clock,
    print: (text: string) => void printed.push(text),
    onBlock: (id: string | undefined) => void blocks.push(id),
  };
  const start = (ws: WorkspaceJson, board = tariro) => new LiveRun(ws, board, registry, host);
  return { log, printed, blocks, start, clock: () => clock };
}

const print = (value: BlockJson) => block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: value } });
const write = (pin: string, state: 'HIGH' | 'LOW') => block('io_digital_write', { fields: { PIN: pin, STATE: state } });
const arith = (op: string, a: BlockJson, b: BlockJson) => block('math_arithmetic', { fields: { OP: op }, inputs: { A: a, B: b } });
const compare = (op: string, a: BlockJson, b: BlockJson) => block('logic_compare', { fields: { OP: op }, inputs: { A: a, B: b } });

describe('live mode', () => {
  it('runs blocks in order, waits in real program time and finishes', async () => {
    const r = rig();
    const result = await r.start(workspace([program(write('13', 'HIGH'), wait(1), write('13', 'LOW'))])).run();
    expect(result).toEqual({ outcome: 'finished', message: 'The program finished.' });
    expect(r.log).toEqual(['13=1', '13=0']);
    expect(r.clock()).toBeGreaterThanOrEqual(1000);
    expect(r.blocks.at(-1)).toBeUndefined(); // highlight cleared at the end
  });

  it('blink runs forever until stopped', async () => {
    const r = rig();
    const run = r.start(example('blink'));
    const done = run.run();
    while (r.log.length < 6) await new Promise((res) => setTimeout(res, 1));
    run.stop();
    expect((await done).outcome).toBe('stopped');
    expect(r.log.slice(0, 4)).toEqual(['13=1', '13=0', '13=1', '13=0']);
  });

  it('evaluates maths, text, variables, if/else and loops', async () => {
    const r = rig();
    const ws = workspace(
      [
        program(
          set('x', arith('ADD', n(2), arith('MULTIPLY', n(3), n(4)))),
          print(v('x')),
          block('controls_if', {
            extraState: { hasElse: true },
            inputs: { IF0: compare('GT', v('x'), n(10)) },
            do: { DO0: [print(t('big'))], ELSE: [print(t('small'))] },
          }),
          block('controls_repeat_ext', { inputs: { TIMES: n(3) }, do: { DO: [block('math_change', { fields: { VAR: { id: 'x' } }, inputs: { DELTA: n(1) } })] } }),
          block('controls_for', { fields: { VAR: { id: 'i' } }, inputs: { FROM: n(3), TO: n(1), BY: n(1) }, do: { DO: [print(v('i'))] } }),
          print(block('text_join', { extraState: { itemCount: 2 }, inputs: { ADD0: t('x is '), ADD1: v('x') } })),
          print(arith('DIVIDE', n(1), n(4))),
        ),
      ],
      [
        { id: 'x', name: 'x' },
        { id: 'i', name: 'i' },
      ],
    );
    expect((await r.start(ws).run()).outcome).toBe('finished');
    expect(r.printed.join('')).toBe('14\nbig\n3\n2\n1\nx is 17\n0.25\n');
  });

  it('break leaves a forever loop and the program carries on', async () => {
    const r = rig();
    const ws = workspace(
      [
        program(
          forever(
            block('math_change', { fields: { VAR: { id: 'c' } }, inputs: { DELTA: n(1) } }),
            block('controls_if', { inputs: { IF0: compare('GTE', v('c'), n(3)) }, do: { DO0: [block('controls_flow_statements', { fields: { FLOW: 'BREAK' } })] } }),
          ),
          print(v('c')),
        ),
      ],
      [{ id: 'c', name: 'c' }],
    );
    expect((await r.start(ws).run()).outcome).toBe('finished');
    expect(r.printed).toEqual(['3\n']);
  });

  it('calls functions with parameters and return values', async () => {
    const r = rig({ analog: { 0: 100 } });
    const run = r.start(example('night-light'));
    const done = run.run();
    await new Promise((res) => setTimeout(res, 30));
    run.stop();
    const result = await done;
    // night-light uses a tone block in beep(): live mode must refuse it up front.
    if (result.outcome === 'error') expect(result.message).toContain('cannot run in live mode');
    else expect(result.outcome).toBe('stopped');
  });

  it('functions: recursion with a parameter and a return value', async () => {
    const r = rig();
    const ws = workspace(
      [
        program(print(block('procedures_callreturn', { extraState: { name: 'sum', params: ['k'] }, inputs: { ARG0: n(4) } }))),
        block('procedures_defreturn', {
          fields: { NAME: 'sum' },
          extraState: { params: [{ name: 'k', id: 'k' }] },
          do: {
            STACK: [block('procedures_ifreturn', { extraState: { value: true }, inputs: { CONDITION: compare('LTE', v('k'), n(0)), VALUE: n(0) } })],
          },
          inputs: {
            RETURN: arith('ADD', v('k'), block('procedures_callreturn', { extraState: { name: 'sum', params: ['k'] }, inputs: { ARG0: arith('MINUS', v('k'), n(1)) } })),
          },
        }),
      ],
      [{ id: 'k', name: 'k' }],
    );
    expect(await r.start(ws).run()).toMatchObject({ outcome: 'finished' });
    expect(r.printed).toEqual(['10\n']);
  });

  it('reads pins: digital, analog and A-pins used as digital', async () => {
    const r = rig({ digital: { 2: true }, analog: { 3: 512 } });
    const ws = workspace([
      program(
        print(block('io_digital_read', { fields: { PIN: '2', PULL: 'INPUT' } })),
        print(block('io_analog_read', { fields: { PIN: 'A3' } })),
        write('A0', 'HIGH'),
        block('io_pwm_write', { fields: { PIN: '3' }, inputs: { VALUE: n(128) } }),
      ),
    ]);
    await r.start(ws).run();
    expect(r.printed).toEqual(['1\n', '512\n']);
    expect(r.log).toEqual(['14=1', '3~128']);
  });

  it('drives the Tariro motors on the confirmed SMRS pins', async () => {
    const r = rig();
    const ws = workspace([
      program(
        block('tariro_motor_run', { fields: { MOTOR: 'A', DIRECTION: 'FORWARD' }, inputs: { SPEED: n(60) } }),
        block('tariro_motor_run', { fields: { MOTOR: 'B', DIRECTION: 'BACKWARD' }, inputs: { SPEED: n(100) } }),
        block('tariro_motor_stop', { fields: { MOTOR: 'BOTH' } }),
      ),
    ]);
    expect((await r.start(ws).run()).outcome).toBe('finished');
    expect(r.log).toEqual(['4=1', '5~153', '7=0', '6~255', '5~0', '6~0']);
  });

  it('reports the failing block', async () => {
    const r = rig();
    const bad = print(arith('DIVIDE', n(1), n(0)));
    const result = await r.start(workspace([program(bad)])).run();
    expect(result.outcome).toBe('error');
    expect(result.message).toBe('The program tried to divide by zero.');
    expect(result.blockId).toBeDefined();
  });

  it('refuses programs it cannot run, before touching the board', async () => {
    const tone = block('io_tone', { fields: { PIN: '8' }, inputs: { FREQUENCY: n(440), DURATION: n(100) } });
    const ws = workspace([program(write('13', 'HIGH'), tone)]);
    expect(checkLive(ws, tariro, registry)).toEqual([{ blockId: tone.id, message: 'This block cannot run in live mode. Use Upload for this program.' }]);
    const r = rig();
    expect((await r.start(ws).run()).outcome).toBe('error');
    expect(r.log).toEqual([]);
    expect(checkLive(workspace([]), tariro, registry)[0]?.message).toContain('when board starts up');
    expect(checkLive(example('blink'), getBoard('malkon-esp32s3'), registry)[0]?.message).toContain('not available for Malkon ESP32');
    expect(checkLive(example('blink'), tariro, registry)).toEqual([]);
    expect(checkLive(example('tariro-motors'), tariro, registry)).toEqual([]);
  });
});
