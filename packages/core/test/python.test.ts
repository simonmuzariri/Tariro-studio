/**
 * The Python environment's runner and `tariro` module, run on real Pyodide (CPython in WebAssembly)
 * in Node with a fake board. The app runs the same code in a worker.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { PYTHON_STOP, pythonErrorLine, runPython, tidyTraceback, type LiveOp, type PyodideLike, type PythonHost } from '../src/index.js';

let py: PyodideLike;
beforeAll(async () => {
  py = (await loadPyodide()) as unknown as PyodideLike;
}, 60_000);

function host(opts: { digital?: Record<number, boolean>; analog?: Record<number, number>; fail?: string } = {}) {
  const ops: string[] = [];
  const out: string[] = [];
  let stop = false;
  let clock = 0;
  const h: PythonHost = {
    request: async (op: LiveOp) => {
      if (opts.fail) throw new Error(opts.fail);
      switch (op.op) {
        case 'digitalWrite':
          ops.push(`${op.pin}=${op.on ? 1 : 0}`);
          return null;
        case 'analogWrite':
          ops.push(`${op.pin}~${op.value}`);
          return null;
        case 'servoWrite':
          ops.push(`${op.pin}^${op.angle}`);
          return null;
        case 'digitalRead':
          return opts.digital?.[op.pin] ? 1 : 0;
        case 'analogRead':
          return opts.analog?.[op.channel] ?? 0;
        case 'analogPin':
          return op.channel < 6 ? 14 + op.channel : null;
      }
    },
    sleep: async (ms) => {
      if (stop) throw new Error(PYTHON_STOP);
      clock += ms;
      await new Promise((r) => setTimeout(r, 0));
      if (stop) throw new Error(PYTHON_STOP);
    },
    output: (stream, text) => void out.push(`${stream}: ${text}`),
    stopping: () => stop,
  };
  return { h, ops, out, clock: () => clock, stop: () => (stop = true) };
}

describe('Python environment (Pyodide)', () => {
  it('runs general Python and prints to the console', async () => {
    const t = host();
    const r = await runPython(py, 'import math\nprint("hi", sum(range(5)), round(math.pi, 2))\nprint([n * n for n in range(4)])', t.h);
    expect(r).toEqual({ outcome: 'finished', message: 'The program finished.' });
    expect(t.out).toEqual(['stdout: hi 10 3.14', 'stdout: [0, 1, 4, 9]']);
  });

  it('drives the board through the tariro module, and time.sleep waits through the app', async () => {
    const t = host({ digital: { 2: true }, analog: { 0: 512 } });
    const code = [
      'from tariro import board, wait',
      'import time',
      'board.digital_write(13, True)',
      'time.sleep(0.5)',
      'board.digital_write(13, 0)',
      'wait(0.25)',
      'board.pwm_write(3, 300)',
      'board.servo_write("A1", -5)',
      'print(board.digital_read(2, pullup=True), board.analog_read("A0"), board.analog_read(0))',
    ].join('\n');
    const r = await runPython(py, code, t.h);
    expect(r.outcome).toBe('finished');
    expect(t.ops).toEqual(['13=1', '13=0', '3~255', '15^0']);
    expect(t.out).toEqual(['stdout: True 512 512']);
    expect(t.clock()).toBe(750);
  });

  it('explains wrong pins and board failures with a BoardError on the learner’s line', async () => {
    const bad = await runPython(py, 'from tariro import board\n\nboard.digital_write(2.5, 1)', host().h);
    expect(bad.outcome).toBe('error');
    expect(bad.message).toBe('tariro.BoardError: A pin must be a whole number, not 2.5');
    expect(bad.line).toBe(3);
    const offline = await runPython(py, 'from tariro import board\nboard.digital_write(13, 1)', host({ fail: 'No board is connected on /dev/ttyACM0.' }).h);
    expect(offline.message).toBe('tariro.BoardError: No board is connected on /dev/ttyACM0.');
    // Pyodide's and the tariro module's own frames are not shown to the learner.
    expect(offline.traceback).not.toMatch(/tariro\.py|_pyodide|pyodide\/ffi/);
    expect(offline.traceback).toContain('File "<exec>", line 2');
  });

  it('a Python error reports the line and the message', async () => {
    const r = await runPython(py, 'x = 1\ny = x / 0\n', host().h);
    expect(r).toMatchObject({ outcome: 'error', message: 'ZeroDivisionError: division by zero', line: 2 });
  });

  it('Stop ends a program that is waiting, even inside "except Exception"', async () => {
    const t = host();
    const run = runPython(py, 'from tariro import wait\nwhile True:\n    try:\n        wait(0.01)\n    except Exception:\n        pass', t.h);
    await new Promise((r) => setTimeout(r, 30));
    t.stop();
    expect((await run).outcome).toBe('stopped');
  });

  it('each run starts with fresh variables', async () => {
    await runPython(py, 'leftover = 5', host().h);
    const r = await runPython(py, 'print(leftover)', host().h);
    expect(r.message).toBe("NameError: name 'leftover' is not defined");
  });

  it('input() fails with a clear error instead of hanging', async () => {
    const r = await runPython(py, 'name = input("Name? ")', host().h);
    expect(r.outcome).toBe('error');
    expect(r.line).toBe(1);
  });
});

describe('traceback helpers', () => {
  const tb = [
    'Traceback (most recent call last):',
    '  File "/lib/python314.zip/_pyodide/_base.py", line 597, in eval_code_async',
    '    await CodeRunner(',
    '  File "<exec>", line 4, in <module>',
    '  File "<exec>", line 2, in go',
    '  File "/tariro/tariro.py", line 70, in digital_write',
    '    self._io("digitalWrite")',
    'tariro.BoardError: nope',
  ].join('\n');
  it('keep the learner’s frames and the error, and find the last line in their program', () => {
    expect(pythonErrorLine(tb)).toBe(2);
    expect(tidyTraceback(tb)).toBe(['Traceback (most recent call last):', '  File "<exec>", line 4, in <module>', '  File "<exec>", line 2, in go', 'tariro.BoardError: nope'].join('\n'));
  });
});
