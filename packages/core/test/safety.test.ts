import { describe, expect, it } from 'vitest';
import { getBoard, MAX_COMMANDS_PER_SECOND, SafetyLayer, WATCHDOG_MS } from '../src/index.js';

const tariro = getBoard('tariro');
const motorPins = Object.entries(tariro.onboard!.find((p) => p.kind === 'dual-motor-driver')!.pins)
  .filter(([k]) => /^(EN|PWM)[AB]$/.test(k))
  .map(([, v]) => v);

describe('safety layer', () => {
  it('passes ordinary commands unchanged and logs them', () => {
    const s = new SafetyLayer();
    s.configure(tariro);
    expect(s.check({ op: 'digitalWrite', pin: 13, on: true }, 0)).toEqual({ allow: true, op: { op: 'digitalWrite', pin: 13, on: true } });
    expect(s.log.at(-1)?.outcome).toBe('ok');
  });

  it('clamps PWM and servo values to safe ranges, and says so', () => {
    const s = new SafetyLayer();
    s.configure(tariro);
    expect(s.check({ op: 'analogWrite', pin: 3, value: 400 }, 0)).toMatchObject({ allow: true, op: { value: 255 }, note: expect.stringContaining('0–255') });
    expect(s.check({ op: 'servoWrite', pin: 9, angle: -30 }, 0)).toMatchObject({ allow: true, op: { angle: 0 } });
    expect(s.log.at(-1)?.outcome).toBe('limited');
  });

  it('applies the motor speed limit to the motor driver speed pins only', () => {
    const s = new SafetyLayer();
    s.configure(tariro, { motorSpeedLimit: 40 });
    expect(motorPins.length).toBe(2);
    for (const pin of motorPins) expect(s.check({ op: 'analogWrite', pin, value: 255 }, 0)).toMatchObject({ allow: true, op: { value: 102 }, note: expect.stringContaining('40 %') });
    // An LED on another PWM pin is not a motor.
    const other = tariro.pins.pwm.find((p) => !motorPins.includes(p))!;
    expect(s.check({ op: 'analogWrite', pin: other, value: 255 }, 0)).toEqual({ allow: true, op: { op: 'analogWrite', pin: other, value: 255 } });
    s.configure(tariro, { motorSpeedLimit: 3 });
    expect(s.current.motorSpeedLimit).toBe(10); // never below 10 %
  });

  it('refuses pins and analog channels the board does not have', () => {
    const s = new SafetyLayer();
    s.configure(tariro);
    expect(s.check({ op: 'digitalWrite', pin: 99, on: true }, 0)).toMatchObject({ allow: false, reason: expect.stringContaining('Pin 99') });
    expect(s.check({ op: 'analogRead', channel: 12 }, 0)).toMatchObject({ allow: false });
  });

  it('the emergency stop refuses everything until it is reset', () => {
    const s = new SafetyLayer();
    s.configure(tariro);
    s.emergencyStop();
    expect(s.check({ op: 'digitalWrite', pin: 13, on: true }, 0)).toMatchObject({ allow: false, reason: expect.stringContaining('emergency stop') });
    expect(s.check({ op: 'analogRead', channel: 0 }, 0).allow).toBe(false);
    s.reset();
    expect(s.check({ op: 'digitalWrite', pin: 13, on: true }, 0).allow).toBe(true);
  });

  it('refuses a flood of commands (a loop without a wait), but not reads', () => {
    const s = new SafetyLayer();
    s.configure(tariro);
    for (let i = 0; i < MAX_COMMANDS_PER_SECOND; i++) expect(s.check({ op: 'digitalWrite', pin: 13, on: i % 2 === 0 }, i).allow).toBe(true);
    expect(s.check({ op: 'digitalWrite', pin: 13, on: true }, 900)).toMatchObject({ allow: false, reason: expect.stringContaining('a second') });
    expect(s.check({ op: 'analogRead', channel: 0 }, 900).allow).toBe(true);
    expect(s.check({ op: 'digitalWrite', pin: 13, on: true }, 2000).allow).toBe(true); // a second later
  });

  it('the watchdog expires when the app has been silent too long', () => {
    const s = new SafetyLayer();
    s.heartbeat(1000);
    expect(s.watchdogExpired(1000 + WATCHDOG_MS)).toBe(false);
    expect(s.watchdogExpired(1001 + WATCHDOG_MS)).toBe(true);
  });
});
