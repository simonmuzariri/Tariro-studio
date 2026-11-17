import { describe, expect, it } from 'vitest';
import { CircuitSimulator, getBoard, siPrefix, waveStats, type Circuit, type Sample } from '../src/index.js';

const uno = getBoard('arduino-uno');

describe('ohmmeter', () => {
  const circuit: Circuit = {
    parts: [
      { kind: 'resistor', id: 'r1', label: 'r1', a: 'A', b: 'B', ohms: 1000 },
      { kind: 'resistor', id: 'r2', label: 'r2', a: 'B', b: 'C', ohms: 2200 },
      { kind: 'resistor', id: 'r3', label: 'r3', a: 'A', b: 'C', ohms: 3200 },
      { kind: 'led', id: 'led', label: 'led', anode: 'C', cathode: 'D', colour: 'red' },
      { kind: 'button', id: 'b', label: 'button', a: 'D', b: 'E' },
      { kind: 'potentiometer', id: 'pot', label: 'pot', high: 'P1', wiper: 'PW', low: 'P2', ohms: 10_000 },
    ],
  };
  it('reads a resistor, series and parallel combinations', () => {
    const sim = new CircuitSimulator(circuit, uno);
    // A–B: 1 kΩ in parallel with (3.2 kΩ + 2.2 kΩ) = 1000 ∥ 5400.
    expect(sim.measureResistance('A', 'B')).toBeCloseTo((1000 * 5400) / 6400, 3);
    // A–C: (1 kΩ + 2.2 kΩ) ∥ 3.2 kΩ = 1.6 kΩ.
    expect(sim.measureResistance('A', 'C')).toBeCloseTo(1600, 3);
    expect(sim.measureResistance('C', 'A')).toBeCloseTo(1600, 3);
    expect(sim.measureResistance('A', 'A')).toBe(0);
  });
  it('an LED reads open at the meter test voltage, and so does an open button', () => {
    const sim = new CircuitSimulator(circuit, uno);
    expect(sim.measureResistance('C', 'D')).toBe(Infinity);
    expect(sim.measureResistance('D', 'E')).toBe(Infinity);
    sim.setInput('b', 1);
    expect(sim.measureResistance('D', 'E')).toBeLessThan(1);
  });
  it('a potentiometer: ends always read its full value, the wiper moves', () => {
    const sim = new CircuitSimulator(circuit, uno);
    expect(sim.measureResistance('P1', 'P2')).toBeCloseTo(10_000, 2);
    sim.setInput('pot', 0.25);
    expect(sim.measureResistance('PW', 'P2')).toBeCloseTo(2500, 2);
    expect(sim.measureResistance('PW', 'P1')).toBeCloseTo(7500, 2);
  });
  it('measures with the power off: the running program does not disturb the reading', async () => {
    const sim = new CircuitSimulator({ parts: [{ kind: 'resistor', id: 'r', label: 'r', a: 'D9', b: 'GND', ohms: 470 }] }, uno);
    await sim.digitalWrite(9, true);
    expect(sim.measureResistance('D9', 'GND')).toBeCloseTo(470, 3);
  });
});

describe('node voltages', () => {
  it('reports every node, including the point between a resistor and an LED', async () => {
    const sim = new CircuitSimulator(
      {
        parts: [
          { kind: 'resistor', id: 'r', label: 'r', a: 'D13', b: 'net:x', ohms: 220 },
          { kind: 'led', id: 'led', label: 'led', anode: 'net:x', cathode: 'GND', colour: 'red' },
        ],
      },
      uno,
    );
    await sim.digitalWrite(13, true);
    const n = sim.getState().nodes;
    expect(n['5V']).toBeCloseTo(5, 6);
    expect(n['GND']).toBe(0);
    expect(n['D13']).toBeGreaterThan(4.6); // the pin's own resistance drops a little
    expect(n['net:x']).toBeGreaterThan(1.7);
    expect(n['net:x']).toBeLessThan(1.9);
    expect(Object.keys(n).some((k) => k.endsWith(':src'))).toBe(false);
  });
});

describe('waveform measurements', () => {
  /** A square wave: high for `high` ms, low for `low` ms, starting low at t=0. */
  const square = (high: number, low: number, periods: number, volts = 5): Sample[] => {
    const out: Sample[] = [];
    for (let i = 0; i < periods; i++) {
      const t0 = i * (high + low);
      out.push({ t: t0, v: 0 }, { t: t0 + low, v: volts });
    }
    return out;
  };

  it('Blink: 1 s on, 1 s off is 0.5 Hz at 50 % duty', () => {
    const s = waveStats(square(1000, 1000, 6), 0, 12_000)!;
    expect(s.min).toBe(0);
    expect(s.max).toBe(5);
    expect(s.frequency).toBeCloseTo(0.5, 6);
    expect(s.duty).toBeCloseTo(0.5, 6);
    expect(s.mean).toBeCloseTo(2.5, 2);
  });

  it('a 25 % duty signal at 10 Hz', () => {
    const s = waveStats(square(25, 75, 20), 0, 2000)!;
    expect(s.frequency).toBeCloseTo(10, 6);
    expect(s.duty).toBeCloseTo(0.25, 6);
  });

  it('a steady level has no frequency, and the value holds from before the window', () => {
    const s = waveStats([{ t: 0, v: 3.3 }], 500, 1500)!;
    expect(s).toEqual({ min: 3.3, max: 3.3, mean: 3.3 });
    expect(waveStats([], 0, 100)).toBeUndefined();
  });

  it('formats readings with SI prefixes', () => {
    expect(siPrefix(0.0123, 'A')).toBe('12.3 mA');
    expect(siPrefix(4700, 'Ω')).toBe('4.7 kΩ');
    expect(siPrefix(1.8123, 'V')).toBe('1.81 V');
    expect(siPrefix(Infinity, 'Ω')).toBe('OL Ω');
    expect(siPrefix(0, 'V')).toBe('0 V');
  });
});
