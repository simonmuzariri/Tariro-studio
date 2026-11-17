import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveService } from '../src/main/services/live.js';
import { mockBackend } from '../src/main/services/backends.js';
import { ToolchainService } from '../src/main/services/toolchain.js';
import type { PortBackend, PortHandle } from '../src/main/services/serial.js';

const fakeCli = join(import.meta.dirname, 'fixtures/fake-arduino-cli.mjs');

describe('LiveService', () => {
  it('connects to a Firmata board, drives pins, reads inputs and resets on disconnect', async () => {
    const writes: string[] = [];
    const states: Array<{ connected: boolean; firmware?: string }> = [];
    const live = new LiveService(mockBackend('firmata', (w) => writes.push(w)), { state: (s) => states.push(s) });
    const r = await live.connect('/dev/ttyMOCK0');
    expect(r).toEqual({ ok: true, needsFirmware: false, message: 'Connected to StandardFirmata 2.5 on /dev/ttyMOCK0.' });
    expect(live.connectedPort).toBe('/dev/ttyMOCK0');
    expect(await live.io({ op: 'digitalWrite', pin: 13, on: true })).toEqual({ value: null });
    expect(await live.io({ op: 'analogWrite', pin: 5, value: 153 })).toEqual({ value: null });
    expect(await live.io({ op: 'analogRead', channel: 0 })).toEqual({ value: 512 });
    expect(await live.io({ op: 'digitalRead', pin: 2, pullup: true })).toEqual({ value: 1 });
    expect(await live.io({ op: 'analogPin', channel: 1 })).toEqual({ value: 15 });
    expect(writes).toEqual(['13=1', '5~153']);
    expect(await live.disconnect(true)).toBe(true);
    expect(states.map((s) => s.connected)).toEqual([true, false]);
    expect(states[0]?.firmware).toBe('StandardFirmata 2.5');
    expect(await live.io({ op: 'digitalWrite', pin: 13, on: true })).toEqual({ error: 'The board is not connected.' });
  });

  it('says the firmware is missing when the board does not speak Firmata', async () => {
    const live = new LiveService(mockBackend('echo'), { state: () => {} }, { handshakeMs: 150, replyMs: 50 });
    const r = await live.connect('/dev/ttyMOCK0');
    expect(r.ok).toBe(false);
    expect(r.needsFirmware).toBe(true);
    expect(live.connectedPort).toBeUndefined();
  });

  it('reports a port that cannot be opened', async () => {
    const backend: PortBackend = { list: async () => [], open: async () => Promise.reject(new Error('busy')) };
    const r = await new LiveService(backend, { state: () => {} }).connect('/dev/ttyX');
    expect(r).toEqual({ ok: false, needsFirmware: false, message: 'The port could not be opened: busy' });
  });

  it('tells the UI when the board is unplugged', async () => {
    let handle: PortHandle | undefined;
    const inner = mockBackend('firmata');
    const backend: PortBackend = { list: inner.list, open: async (p, b) => (handle = await inner.open(p, b)) };
    const states: Array<{ connected: boolean; error?: string }> = [];
    const live = new LiveService(backend, { state: (s) => states.push(s) });
    await live.connect('/dev/ttyMOCK0');
    handle!.close();
    expect(states.at(-1)).toMatchObject({ connected: false, error: 'The board was disconnected.' });
    expect((await live.io({ op: 'analogRead', channel: 0 }))).toEqual({ error: 'The board is not connected.' });
  });
});

describe('live firmware install', () => {
  it('installs the Firmata library, then compiles and uploads its StandardFirmata example', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tariro-live-'));
    const record = join(dir, 'calls.jsonl');
    process.env['FAKE_CLI_RECORD'] = record;
    try {
      const log: string[] = [];
      const t = new ToolchainService({ cliPath: fakeCli, workDir: dir, events: { log: (e) => log.push(e.line), progress: () => {} } });
      const r = await t.uploadLibraryExample({ fqbn: 'arduino:avr:uno', port: '/dev/ttyMOCK0', projectId: 'live-firmware', library: { name: 'Firmata', version: '2.5.9' }, example: 'StandardFirmata' });
      expect(r.ok).toBe(true);
      expect(readFileSync(join(dir, 'live-firmware/sketch/sketch.ino'), 'utf8')).toContain('stand-in for the Firmata library example');
      const calls = readFileSync(record, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
      expect(calls.map((c) => c[0])).toEqual(['lib', 'lib', 'lib', 'compile', 'upload']);
      const missing = await t.uploadLibraryExample({ fqbn: 'arduino:avr:uno', port: '/dev/ttyMOCK0', projectId: 'live-firmware', library: { name: 'Firmata', version: '2.5.9' }, example: 'NoSuchExample' });
      expect(missing).toMatchObject({ ok: false, message: 'The NoSuchExample sketch was not found in the Firmata library.' });
    } finally {
      delete process.env['FAKE_CLI_RECORD'];
    }
  });
});

describe('LiveService safety (Phase 5a)', () => {
  it('limits motor speed, refuses bad pins, latches the emergency stop and switches the board off', async () => {
    const writes: string[] = [];
    const events: string[] = [];
    const states: Array<{ connected: boolean; estop?: boolean }> = [];
    const live = new LiveService(mockBackend('firmata', (w) => writes.push(w)), { state: (s) => states.push(s), safety: (e) => events.push(`${e.kind}: ${e.message}`) });
    const { getBoard } = await import('@tariro-studio/core');
    const tariro = getBoard('tariro');
    const enA = tariro.onboard!.find((p) => p.kind === 'dual-motor-driver')!.pins['ENA'] ?? tariro.onboard![0]!.pins['PWMA']!;
    live.configureSafety(tariro, { motorSpeedLimit: 50 });
    expect((await live.connect('/dev/ttyMOCK0')).ok).toBe(true);
    expect(await live.io({ op: 'analogWrite', pin: enA, value: 255 })).toEqual({ value: null });
    expect(writes.at(-1)).toBe(`${enA}~127`);
    expect(events).toContain('limited: Motor speed limited to 50 % by the safety settings.');
    expect(await live.io({ op: 'digitalWrite', pin: 99, on: true })).toMatchObject({ error: expect.stringContaining('Pin 99') });

    await live.emergencyStop();
    expect(live.connectedPort).toBeUndefined();
    expect(states.at(-1)).toMatchObject({ connected: false, estop: true });
    expect(events.at(-1)).toContain('Emergency stop');
    expect((await live.connect('/dev/ttyMOCK0')).message).toContain('emergency stop is on');
    live.resetEmergencyStop();
    expect((await live.connect('/dev/ttyMOCK0')).ok).toBe(true);
    await live.disconnect(true);
  });

  it('the watchdog switches the board off when the app stops sending heartbeats', async () => {
    const events: string[] = [];
    const live = new LiveService(mockBackend('firmata', () => {}), { state: () => {}, safety: (e) => events.push(e.kind) });
    expect((await live.connect('/dev/ttyMOCK0')).ok).toBe(true);
    const t = Date.now();
    live.heartbeat(t);
    await live.checkWatchdog(t + 1000);
    expect(live.connectedPort).toBe('/dev/ttyMOCK0'); // still within the limit
    await live.checkWatchdog(t + 2000);
    expect(live.connectedPort).toBeUndefined();
    expect(events).toEqual(['watchdog']);
  });
});
