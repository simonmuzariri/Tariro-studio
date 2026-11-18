/** Phase 6b: the Tello text protocol and the guard every real-drone command passes through. */
import { describe, expect, it } from 'vitest';
import { DroneGuard, parseTelloState, telloText, type TelloTelemetry } from '../src/index.js';

const state = (over: Partial<TelloTelemetry> = {}): TelloTelemetry => ({ pitch: 0, roll: 0, yaw: 0, h: 0, tof: 10, bat: 80, time: 0, ...over });

describe('the Tello protocol', () => {
  it('writes the SDK 2.0 commands', () => {
    expect(telloText({ kind: 'takeoff' })).toBe('takeoff');
    expect(telloText({ kind: 'move', direction: 'forward', cm: 100.4 })).toBe('forward 100');
    expect(telloText({ kind: 'turn', direction: 'right', degrees: 90 })).toBe('cw 90');
    expect(telloText({ kind: 'turn', direction: 'left', degrees: 45 })).toBe('ccw 45');
    expect(telloText({ kind: 'flip', direction: 'back' })).toBe('flip b');
    expect(telloText({ kind: 'speed', cmPerSecond: 50 })).toBe('speed 50');
  });

  it('reads the state broadcast, and ignores anything else', () => {
    const t = parseTelloState('pitch:1;roll:-2;yaw:93;vgx:0;vgy:0;vgz:0;templ:60;temph:62;tof:85;h:80;bat:76;baro:13.40;time:12;agx:3.00;agy:2.00;agz:-999.00;\r\n');
    expect(t).toEqual({ pitch: 1, roll: -2, yaw: 93, h: 80, tof: 85, bat: 76, time: 12 });
    expect(parseTelloState('ok')).toBeUndefined();
  });
});

describe('the drone guard', () => {
  it('refuses to move on the ground, and to take off on a flat battery', () => {
    const g = new DroneGuard();
    expect(g.check({ kind: 'move', direction: 'up', cm: 50 })).toEqual({ allow: false, reason: 'Take off first: the drone is on the ground.' });
    g.report(state({ bat: 7 }));
    expect(g.check({ kind: 'takeoff' })).toMatchObject({ allow: false, reason: expect.stringMatching(/charge it/) });
    g.report(state({ bat: 60 }));
    expect(g.check({ kind: 'takeoff' })).toEqual({ allow: true });
  });

  it('keeps an estimate from the moves the drone made, and refuses one that leaves the fence', () => {
    const g = new DroneGuard();
    g.setLimits({ fenceRadius: 300, maxHeight: 200 });
    g.report(state({ yaw: 30 }));
    g.done({ kind: 'takeoff' });
    g.done({ kind: 'move', direction: 'forward', cm: 250 });
    expect(g.state(true)).toMatchObject({ flying: true, y: 250 });
    expect(g.check({ kind: 'move', direction: 'forward', cm: 100 })).toMatchObject({ allow: false, reason: expect.stringMatching(/outside its 300 cm fence/) });
    // Turned round, the same move heads back towards the pad.
    g.report(state({ yaw: 30 + 180, h: 80 }));
    expect(g.state(true).heading).toBe(180);
    expect(g.check({ kind: 'move', direction: 'forward', cm: 100 })).toEqual({ allow: true });
    expect(g.log.filter((l) => l.outcome === 'refused')).toHaveLength(1);
  });

  it('uses the height the drone reports, and asks to land when it is well above the limit', () => {
    const g = new DroneGuard();
    g.setLimits({ maxHeight: 150 });
    g.done({ kind: 'takeoff' });
    expect(g.report(state({ h: 140 }))).toBeUndefined();
    expect(g.check({ kind: 'move', direction: 'up', cm: 20 })).toMatchObject({ allow: false, reason: expect.stringMatching(/above its 150 cm height limit/) });
    expect(g.report(state({ h: 190 }))).toMatch(/landing/);
  });

  it('flips only with 50 % battery and 60 cm of height; a watchdog notices a silent app', () => {
    const g = new DroneGuard();
    g.done({ kind: 'takeoff' });
    g.report(state({ h: 80, bat: 45 }));
    expect(g.check({ kind: 'flip', direction: 'left' })).toMatchObject({ allow: false, reason: expect.stringMatching(/50 % battery/) });
    g.heartbeat(1000);
    expect(g.watchdogExpired(2000)).toBe(false);
    expect(g.watchdogExpired(3000)).toBe(true);
  });
});
