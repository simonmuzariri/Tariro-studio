import { describe, expect, it } from 'vitest';
import { REPL } from '@tariro-studio/core';
import { MicroPythonService } from '../src/main/services/micropython.js';
import type { PortBackend, PortHandle } from '../src/main/services/serial.js';

/** A board that speaks just enough raw REPL: records executed snippets and soft resets. */
class FakeBoard implements PortHandle {
  isOpen = true;
  raw = false;
  executed: string[] = [];
  resets = 0;
  private pending = '';
  private onData: (chunk: Buffer) => void = () => {};
  constructor(private readonly behaviour: 'ok' | 'silent' | 'error' = 'ok') {}
  on(event: string, cb: (arg: never) => void): unknown {
    if (event === 'data') this.onData = cb as unknown as (chunk: Buffer) => void;
    return this;
  }
  write(data: string, cb?: (err: Error | null | undefined) => void): boolean {
    for (const ch of data) {
      if (ch === REPL.RAW) {
        this.raw = true;
        if (this.behaviour !== 'silent') this.say(`${REPL.RAW_BANNER}\r\n>`);
      } else if (ch === REPL.NORMAL) this.raw = false;
      else if (ch === REPL.EXECUTE) {
        if (!this.raw) this.resets++;
        else {
          this.executed.push(this.pending);
          this.say(this.behaviour === 'error' && this.pending.startsWith('f.write') ? `OK${REPL.EXECUTE}OSError: 28\r\n${REPL.EXECUTE}>` : `OK${REPL.EXECUTE}${REPL.EXECUTE}>`);
        }
        this.pending = '';
      } else if (ch !== REPL.INTERRUPT && ch !== '\r') this.pending += ch;
    }
    cb?.(null);
    return true;
  }
  close(cb?: () => void): void {
    this.isOpen = false;
    cb?.();
  }
  private say(text: string) {
    setTimeout(() => this.onData(Buffer.from(text)), 1);
  }
}

const service = (board: FakeBoard, opened: string[] = []) => {
  const backend: PortBackend = {
    list: async () => [],
    open: async (path, baud) => {
      opened.push(`${path}@${baud}`);
      return board;
    },
  };
  const progress: Array<number | undefined> = [];
  const svc = new MicroPythonService(backend, { log: () => {}, progress: (p) => progress.push(p.percent) }, { settleMs: 5, promptMs: 200, commandMs: 200 });
  return { svc, progress };
};

describe('MicroPythonService', () => {
  it('writes main.py through the raw REPL, then soft-resets and closes the port', async () => {
    const board = new FakeBoard();
    const opened: string[] = [];
    const { svc, progress } = service(board, opened);
    const code = 'print("hello")\n'.repeat(40);
    const r = await svc.upload('/dev/ttyACM0', code);
    expect(r).toMatchObject({ ok: true, phase: 'done' });
    expect(opened).toEqual(['/dev/ttyACM0@115200']);
    expect(board.executed[0]).toBe(`f=open("main.py",'wb')`);
    expect(board.executed.at(-1)).toBe('f.close()');
    expect(board.executed.filter((c) => c.startsWith('f.write(b')).length).toBeGreaterThan(1);
    expect(board.resets).toBe(1);
    expect(board.isOpen).toBe(false);
    expect(progress.at(-2)).toBe(100);
  });

  it('explains a board without MicroPython', async () => {
    const board = new FakeBoard('silent');
    const r = await service(board).svc.upload('/dev/ttyUSB0', 'x=1\n');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/MicroPython did not answer/);
    expect(board.isOpen).toBe(false);
  });

  it('stops and reports when the board rejects a write (for example a full disk)', async () => {
    const board = new FakeBoard('error');
    const r = await service(board).svc.upload('/dev/ttyUSB0', 'x=1\n');
    expect(r).toMatchObject({ ok: false, phase: 'error' });
    expect(board.resets).toBe(0);
  });
});
