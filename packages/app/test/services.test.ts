import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventPayload } from '@tariro-studio/core';
import { ToolchainService } from '../src/main/services/toolchain.js';
import { SerialService, describePort } from '../src/main/services/serial.js';
import { mockBackend } from '../src/main/services/backends.js';
import { fakeCliPath } from './fixtures/fake-cli.js';

const req = { code: 'void setup(){}\nvoid loop(){}\n', fqbn: 'arduino:avr:uno', projectId: 'test' };

describe('ToolchainService (fake arduino-cli)', () => {
  let work: string;
  let logs: EventPayload<'toolchain:log'>[];
  let progress: EventPayload<'toolchain:progress'>[];
  let releases: string[];
  let reopened: number;
  const make = () =>
    new ToolchainService({
      cliPath: fakeCliPath(),
      workDir: work,
      events: { log: (e) => logs.push(e), progress: (e) => progress.push(e) },
      releasePort: async (port) => {
        releases.push(port);
        return async () => {
          reopened++;
        };
      },
    });

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'tariro-tc-'));
    logs = [];
    progress = [];
    releases = [];
    reopened = 0;
    delete process.env['FAKE_CLI_MODE'];
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  it('reports status with version and installed platforms', () => {
    const s = make().status('arduino:avr:uno');
    expect(s).toMatchObject({ ready: true, version: '1.3.1-fake', platforms: ['arduino:avr@1.8.7'] });
    expect(make().status('esp32:esp32:esp32')).toMatchObject({ ready: false, problem: expect.stringMatching(/esp32:esp32/) });
  });

  it('reports a missing CLI clearly', async () => {
    const tc = new ToolchainService({ cliPath: undefined, workDir: work, events: { log: () => {}, progress: () => {} } });
    expect(tc.status().ready).toBe(false);
    expect((await tc.compile(req)).message).toMatch(/not found/);
  });

  it('compiles, writes the sketch and reports memory use', async () => {
    const r = await make().compile(req);
    expect(r).toMatchObject({ ok: true, phase: 'done', sizes: { flash: 924, flashMax: 32256, ram: 9, ramMax: 2048 } });
    expect(r.message).toMatch(/Compiled successfully \(3% of the board's memory\)/);
    expect(readFileSync(join(work, 'test', 'sketch', 'sketch.ino'), 'utf8')).toBe(req.code);
    expect(progress[0]).toEqual({ phase: 'compiling' });
    expect(logs.some((l) => l.line.startsWith('Sketch uses'))).toBe(true);
  });

  it('installs missing pinned libraries before compiling (and skips ones already present)', async () => {
    const record = join(work, 'calls.jsonl');
    process.env['FAKE_CLI_RECORD'] = record;
    try {
      const r = await make().compile({ ...req, libraries: [{ name: 'Servo', version: '1.3.0' }, { name: 'DHT sensor library', version: '1.4.7' }] });
      expect(r.ok).toBe(true);
      const calls = readFileSync(record, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
      expect(calls.filter((c) => c[0] === 'lib' && c[1] === 'install')).toEqual([['lib', 'install', 'DHT sensor library@1.4.7']]);
      expect(logs.some((l) => l.line === 'Installing library DHT sensor library 1.4.7…')).toBe(true);
    } finally {
      delete process.env['FAKE_CLI_RECORD'];
    }
  });

  it('explains a library that cannot be installed (offline)', async () => {
    process.env['FAKE_CLI_MODE'] = 'lib-fail';
    const r = await make().compile({ ...req, libraries: [{ name: 'Adafruit SSD1306', version: '2.5.17' }] });
    expect(r).toMatchObject({ ok: false, phase: 'error' });
    expect(r.message).toMatch(/Adafruit SSD1306" is needed but could not be installed/);
  });

  it('returns sketch diagnostics on a compile error', async () => {
    process.env['FAKE_CLI_MODE'] = 'compile-error';
    const r = await make().compile(req);
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual([
      { file: 'sketch.ino', line: 12, column: 3, severity: 'error', message: "'foo' was not declared in this scope" },
    ]);
  });

  it('uploads after compiling, streams progress and frees then reopens the monitor port', async () => {
    const r = await make().upload({ ...req, port: '/dev/ttyUSB0' });
    expect(r).toMatchObject({ ok: true, phase: 'done' });
    expect(progress.filter((p) => p.phase === 'uploading').map((p) => p.percent)).toEqual([0, 0, 50, 100]);
    expect(releases).toEqual(['/dev/ttyUSB0']);
    expect(reopened).toBe(1);
  });

  it('explains an unresponsive board', async () => {
    process.env['FAKE_CLI_MODE'] = 'upload-fail';
    const r = await make().upload({ ...req, port: '/dev/ttyUSB0' });
    expect(r).toMatchObject({ ok: false, phase: 'error' });
    expect(r.message).toMatch(/did not answer/);
    expect(reopened).toBe(1);
  });

  it('cancels a running upload, including child processes', async () => {
    process.env['FAKE_CLI_MODE'] = 'slow';
    const tc = make();
    const running = tc.upload({ ...req, port: '/dev/ttyUSB0' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(tc.cancel()).toBe(true);
    const r = await running;
    expect(r).toMatchObject({ ok: false, phase: 'cancelled' });
  }, 20_000);

  it('refuses a second job while one is running', async () => {
    process.env['FAKE_CLI_MODE'] = 'slow';
    const tc = make();
    const running = tc.upload({ ...req, port: '/dev/ttyUSB0' });
    await new Promise((r) => setTimeout(r, 300));
    expect((await tc.compile(req)).message).toMatch(/still running/);
    tc.cancel();
    await running;
  }, 20_000);
});

describe('SerialService (mock port)', () => {
  it('lists the mock Tariro with board recognition', async () => {
    const ports: EventPayload<'serial:ports'>[] = [];
    const s = new SerialService(mockBackend(), { ports: (p) => ports.push(p), data: () => {}, state: () => {} });
    const list = await s.refresh();
    expect(list).toEqual([
      expect.objectContaining({ path: '/dev/ttyMOCK0', suggestedBoardId: 'tariro', label: '/dev/ttyMOCK0 — Tariro Robotics (Malkon SMRS)' }),
    ]);
    expect(ports).toHaveLength(1);
    await s.refresh();
    expect(ports).toHaveLength(1); // unchanged list → no event
  });

  it('opens, echoes written data, and closes', async () => {
    const data: string[] = [];
    const states: EventPayload<'serial:state'>[] = [];
    const s = new SerialService(mockBackend(), { ports: () => {}, data: (d) => data.push(d.data), state: (st) => states.push(st) });
    expect(await s.open('/dev/ttyMOCK0', 9600)).toEqual({ open: true, path: '/dev/ttyMOCK0', baud: 9600 });
    expect(await s.write('hello\n')).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(data.join('')).toBe('hello\n');
    expect((await s.close()).open).toBe(false);
  });

  it('releases the port for upload and reopens it afterwards', async () => {
    const states: EventPayload<'serial:state'>[] = [];
    const s = new SerialService(mockBackend(), { ports: () => {}, data: () => {}, state: (st) => states.push(st) });
    await s.open('/dev/ttyMOCK0', 115200);
    const reopen = await s.releaseForUpload('/dev/ttyMOCK0');
    expect(states.at(-1)?.open).toBe(false);
    await reopen();
    expect(states.at(-1)).toEqual({ open: true, path: '/dev/ttyMOCK0', baud: 115200 });
    await s.close();
  });

  it('reports a friendly error for a missing port', async () => {
    const s = new SerialService(mockBackend(), { ports: () => {}, data: () => {}, state: () => {} });
    const st = await s.open('/dev/ttyNOPE', 9600);
    expect(st.open).toBe(false);
    expect(st.error).toBeTruthy();
  });

  it('hides non-USB serial ports and labels unknown USB devices by manufacturer', () => {
    expect(describePort({ path: '/dev/ttyUSB3', vendorId: '10C4', productId: 'EA60', manufacturer: 'Silicon Labs' })).toEqual({
      path: '/dev/ttyUSB3',
      label: '/dev/ttyUSB3 — Silicon Labs',
      vid: '10c4',
      pid: 'ea60',
      manufacturer: 'Silicon Labs',
    });
  });
});
