/** Phase 6b: the real-drone link over UDP, flown against a pretend Tello on this computer. */
import { afterEach, describe, expect, it } from 'vitest';
import type { DroneLinkState } from '@tariro-studio/core';
import { TelloService } from '../src/main/services/tello.js';
import { FakeTello } from '../src/main/services/fake-tello.js';

let port = 29889;
const running: Array<{ tello: TelloService; drone: FakeTello }> = [];

async function setup() {
  const p = (port += 2);
  const drone = new FakeTello(p, p + 1);
  await drone.start();
  const states: DroneLinkState[] = [];
  const tello = new TelloService({ host: '127.0.0.1', port: p, statePort: p + 1 }, (s) => void states.push(s));
  running.push({ tello, drone });
  return { tello, drone, states };
}

afterEach(async () => {
  for (const { tello, drone } of running.splice(0)) {
    tello.emergency();
    await tello.disconnect();
    drone.stop();
  }
});

describe('the Tello link', () => {
  it('connects in SDK mode, flies through the guard, and lands', async () => {
    const { tello, drone, states } = await setup();
    expect(await tello.connect()).toEqual({ ok: true, message: 'Connected to the drone.' });
    tello.setLimits({ maxHeight: 200, fenceRadius: 150 });
    tello.heartbeat();
    expect(await tello.command({ kind: 'takeoff' })).toEqual({ ok: true });
    expect(await tello.command({ kind: 'speed', cmPerSecond: 100 })).toEqual({ ok: true });
    tello.heartbeat();
    expect(await tello.command({ kind: 'move', direction: 'forward', cm: 100 })).toEqual({ ok: true });
    tello.heartbeat();
    // The guard knows where it is: another metre forwards would leave the 150 cm fence. Not sent.
    const refused = await tello.command({ kind: 'move', direction: 'forward', cm: 100 });
    expect(refused).toMatchObject({ error: expect.stringMatching(/outside its 150 cm fence/) });
    expect(drone.received.filter((r) => r.startsWith('forward'))).toEqual(['forward 100']);
    expect(drone.sim.state().y).toBeCloseTo(100, 0);
    expect(await tello.command({ kind: 'land' })).toEqual({ ok: true });
    expect(drone.sim.state().flying).toBe(false);
    expect(drone.received.slice(0, 2)).toEqual(['command', 'takeoff']);
    // The drone's state reaches the window, with the height it reports.
    expect(states.some((s) => s.flying && s.z > 70)).toBe(true);
  }, 20_000);

  it('says so when no drone answers', async () => {
    const tello = new TelloService({ host: '127.0.0.1', port: 29700, statePort: 29701 }, () => {});
    const r = await tello.connect();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/join its Wi-Fi network/);
    expect(await tello.command({ kind: 'takeoff' })).toEqual({ error: 'The drone is not connected.' });
  }, 10_000);

  it('lands the drone when the app stops sending heartbeats, and the emergency stop cuts the motors', async () => {
    const { tello, drone, states } = await setup();
    await tello.connect();
    tello.heartbeat();
    await tello.command({ kind: 'takeoff' });
    // No heartbeat for longer than the watchdog allows.
    await new Promise((r) => setTimeout(r, 1700));
    tello.checkWatchdog();
    await expect.poll(() => drone.sim.state().flying, { timeout: 8000 }).toBe(false);
    expect(states.some((s) => s.message === 'The app stopped answering: the drone is landing.')).toBe(true);
    expect(drone.received).toContain('stop');
    expect(drone.received.at(-1)).toBe('land');

    tello.heartbeat();
    await tello.command({ kind: 'takeoff' });
    expect(tello.emergency()).toBe(true);
    await expect.poll(() => drone.received.at(-1)).toBe('emergency');
    await expect.poll(() => drone.sim.state().phase).toMatch(/falling|ground/);
  }, 25_000);
});
