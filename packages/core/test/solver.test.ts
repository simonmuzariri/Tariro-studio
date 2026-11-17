import { describe, expect, it } from 'vitest';
import { ledModel, solve, type Element } from '../src/sim/solver.js';

const R = (id: string, a: string, b: string, ohms: number): Element => ({ type: 'R', id, a, b, ohms });
const V = (id: string, pos: string, volts: number, neg = 'GND'): Element => ({ type: 'V', id, pos, neg, volts });
const LED = (id: string, anode: string, cathode: string, vf = 1.8): Element => ({ type: 'D', id, anode, cathode, ...ledModel(vf) });

describe('circuit solver', () => {
  it("Ohm's law: 5 V across 1 kΩ is 5 mA", () => {
    const s = solve([V('v', 'a', 5), R('r', 'a', 'GND', 1000)]);
    expect(s.volts['a']).toBeCloseTo(5, 9);
    expect(s.amps['r']).toBeCloseTo(0.005, 9);
    expect(s.amps['v']).toBeCloseTo(0.005, 9); // the source supplies what the resistor takes
  });

  it('series resistors divide the voltage', () => {
    const s = solve([V('v', 'top', 9), R('r1', 'top', 'mid', 2000), R('r2', 'mid', 'GND', 1000)]);
    expect(s.volts['mid']).toBeCloseTo(3, 6);
    expect(s.amps['r1']).toBeCloseTo(0.003, 9);
    expect(s.amps['r2']).toBeCloseTo(0.003, 9);
  });

  it('parallel resistors share the current', () => {
    const s = solve([V('v', 'a', 6), R('r1', 'a', 'GND', 100), R('r2', 'a', 'GND', 200), R('r3', 'a', 'GND', 300)]);
    expect(s.amps['r1']).toBeCloseTo(0.06, 9);
    expect(s.amps['r2']).toBeCloseTo(0.03, 9);
    expect(s.amps['r3']).toBeCloseTo(0.02, 9);
    expect(s.amps['v']).toBeCloseTo(0.11, 9); // Kirchhoff's current law
  });

  it('a Wheatstone bridge in balance has no current through the middle', () => {
    const s = solve([V('v', 'top', 10), R('a', 'top', 'l', 1000), R('b', 'l', 'GND', 2000), R('c', 'top', 'r', 500), R('d', 'r', 'GND', 1000), R('m', 'l', 'r', 50)]);
    expect(s.volts['l']).toBeCloseTo(s.volts['r']!, 9);
    expect(s.amps['m']).toBeCloseTo(0, 9);
  });

  it('an LED with a 220 Ω resistor on 5 V: about 1.8 V across the LED and 14 mA', () => {
    const s = solve([V('v', 'pin', 5), R('r', 'pin', 'led', 220), LED('d', 'led', 'GND')]);
    expect(s.converged).toBe(true);
    expect(s.volts['led']).toBeGreaterThan(1.75);
    expect(s.volts['led']).toBeLessThan(1.9);
    expect(s.amps['d']! * 1000).toBeGreaterThan(13.5);
    expect(s.amps['d']! * 1000).toBeLessThan(15);
    expect(s.amps['d']).toBeCloseTo(s.amps['r']!, 6); // same current through both: they are in series
  });

  it('the LED model drops its forward voltage at 10 mA', () => {
    // Choose the resistor so that 10 mA flows when the LED drops exactly 2.0 V.
    const s = solve([V('v', 'p', 5), R('r', 'p', 'k', 300), LED('d', 'k', 'GND', 2.0)]);
    expect(s.volts['k']).toBeCloseTo(2.0, 2);
    expect(s.amps['d']! * 1000).toBeCloseTo(10, 1);
  });

  it('a reversed LED blocks the current', () => {
    const s = solve([V('v', 'pin', 5), R('r', 'pin', 'k', 220), LED('d', 'GND', 'k')]);
    expect(s.converged).toBe(true);
    expect(Math.abs(s.amps['r']!)).toBeLessThan(1e-9);
    expect(s.volts['k']).toBeCloseTo(5, 3);
  });

  it('an LED with no resistor draws a damaging current from a pin-like source', () => {
    // A pin is roughly a source with 25 Ω in series.
    const s = solve([V('v', 'src', 5), R('pin', 'src', 'a', 25), LED('d', 'a', 'GND')]);
    expect(s.converged).toBe(true);
    expect(s.amps['d']! * 1000).toBeGreaterThan(100);
  });

  it('two LEDs in parallel on one resistor share the current; a blue one in parallel with a red one stays dark', () => {
    const same = solve([V('v', 'p', 5), R('r', 'p', 'n', 220), LED('d1', 'n', 'GND'), LED('d2', 'n', 'GND')]);
    expect(same.amps['d1']).toBeCloseTo(same.amps['d2']!, 9);
    const mixed = solve([V('v', 'p', 5), R('r', 'p', 'n', 220), LED('red', 'n', 'GND', 1.8), LED('blue', 'n', 'GND', 3.0)]);
    expect(mixed.amps['red']! * 1000).toBeGreaterThan(13);
    expect(mixed.amps['blue']! * 1000).toBeLessThan(0.001); // the red LED holds the node near 1.8 V
  });

  it('a floating node reads 0 V and does not break the solution', () => {
    const s = solve([V('v', 'a', 5), R('r', 'a', 'GND', 1000), R('dangling', 'x', 'y', 1000)]);
    expect(s.volts['x']).toBeCloseTo(0, 6);
    expect(s.amps['r']).toBeCloseTo(0.005, 9);
  });

  it('a pull-up with an open and a closed button', () => {
    const open = solve([V('v', '5V', 5), R('pull', '5V', 'pin', 35000)]);
    expect(open.volts['pin']).toBeCloseTo(5, 3);
    const closed = solve([V('v', '5V', 5), R('pull', '5V', 'pin', 35000), R('button', 'pin', 'GND', 0.1)]);
    expect(closed.volts['pin']).toBeLessThan(0.001);
  });
});
