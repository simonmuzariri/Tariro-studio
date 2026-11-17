import { describe, expect, it } from 'vitest';
import { CircuitSimulator, getBoard, pinLabel, nodeOfPinField, type Circuit } from '../src/index.js';

const uno = getBoard('arduino-uno');
const ledOn13: Circuit = {
  parts: [
    { kind: 'resistor', id: 'r', label: '220 Ω resistor', a: 'D13', b: 'n1', ohms: 220 },
    { kind: 'led', id: 'led', label: 'LED', anode: 'n1', cathode: 'GND', colour: 'red' },
  ],
};

describe('CircuitSimulator', () => {
  it('names pins the way the board does', () => {
    expect(nodeOfPinField(uno, '13')).toBe('D13');
    expect(nodeOfPinField(uno, 'A0')).toBe('D14');
    expect(pinLabel(uno, 'D14')).toBe('A0');
    expect(nodeOfPinField(getBoard('arduino-mega'), 'A0')).toBe('D54');
  });

  it('an LED is dark until the program drives its pin HIGH', async () => {
    const sim = new CircuitSimulator(ledOn13, uno);
    expect(sim.getState().parts['led']!.level).toBe(0);
    await sim.digitalWrite(13, true);
    const on = sim.getState();
    expect(on.parts['led']!.milliamps).toBeGreaterThan(12);
    expect(on.parts['led']!.milliamps).toBeLessThan(15);
    expect(on.parts['led']!.level).toBeGreaterThan(0.75);
    expect(on.pins['D13']).toMatchObject({ mode: 'output' });
    expect(on.pins['D13']!.milliamps).toBeCloseTo(on.parts['led']!.milliamps, 3);
    expect(on.problems).toEqual([]);
    await sim.digitalWrite(13, false);
    expect(sim.getState().parts['led']!.level).toBe(0);
  });

  it('PWM dims the LED', async () => {
    const sim = new CircuitSimulator(ledOn13, uno);
    await sim.analogWrite(13, 255);
    const full = sim.getState().parts['led']!.milliamps;
    await sim.analogWrite(13, 128);
    const half = sim.getState().parts['led']!.milliamps;
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(full * 0.5);
  });

  it('warns when an LED has no resistor', async () => {
    const sim = new CircuitSimulator({ parts: [{ kind: 'led', id: 'led', label: 'LED on pin 8', anode: 'D8', cathode: 'GND', colour: 'red' }] }, uno);
    await sim.digitalWrite(8, true);
    const s = sim.getState();
    expect(s.problems.join(' ')).toContain('LED on pin 8');
    expect(s.problems.join(' ')).toContain('needs a resistor');
    expect(s.problems.join(' ')).toContain('Pin 8 carries');
  });

  it('a button to GND with the internal pull-up reads HIGH until pressed', async () => {
    const sim = new CircuitSimulator({ parts: [{ kind: 'button', id: 'b', label: 'button', a: 'D2', b: 'GND' }] }, uno);
    expect(await sim.digitalRead(2, true)).toBe(true);
    sim.setInput('b', 1);
    expect(await sim.digitalRead(2, true)).toBe(false);
    sim.setInput('b', 0);
    expect(await sim.digitalRead(2, true)).toBe(true);
  });

  it('a pin with nothing connected and no pull-up reads LOW', async () => {
    expect(await new CircuitSimulator({ parts: [] }, uno).digitalRead(7, false)).toBe(false);
  });

  it('a potentiometer sweeps analogRead from 0 to 1023', async () => {
    const sim = new CircuitSimulator({ parts: [{ kind: 'potentiometer', id: 'p', label: 'potentiometer', high: '5V', wiper: 'D14', low: 'GND', ohms: 10_000 }] }, uno);
    expect(await sim.analogRead(0)).toBeGreaterThan(505);
    expect(await sim.analogRead(0)).toBeLessThan(518);
    sim.setInput('p', 1);
    expect(await sim.analogRead(0)).toBeGreaterThan(1020);
    sim.setInput('p', 0);
    expect(await sim.analogRead(0)).toBeLessThan(3);
    expect(await sim.analogPin(0)).toBe(14);
    expect(await sim.analogPin(9)).toBeUndefined();
  });

  it('a motor channel follows its direction and PWM pins', async () => {
    const sim = new CircuitSimulator({ parts: [{ kind: 'motor', id: 'm', label: 'motor A', direction: 'D4', speed: 'D5' }] }, uno);
    await sim.digitalWrite(4, true);
    await sim.analogWrite(5, 153);
    expect(sim.getState().parts['m']!.level).toBeCloseTo(0.6, 2);
    await sim.digitalWrite(4, false);
    expect(sim.getState().parts['m']!.level).toBeCloseTo(-0.6, 2);
    await sim.analogWrite(5, 0);
    expect(sim.getState().parts['m']!.level).toBeCloseTo(0, 5);
  });

  it('a buzzer sounds, a detector signal is read, and listeners hear every change', async () => {
    const sim = new CircuitSimulator(
      {
        parts: [
          { kind: 'buzzer', id: 'bz', label: 'buzzer', pos: 'D8', neg: 'GND' },
          { kind: 'signal', id: 'ir', label: 'IR sensor', output: 'D7', activeHigh: false },
        ],
      },
      uno,
    );
    let changes = 0;
    sim.onChange(() => changes++);
    await sim.digitalWrite(8, true);
    expect(sim.getState().parts['bz']!.level).toBe(1);
    expect(await sim.digitalRead(7, false)).toBe(true); // nothing detected: an active-LOW output idles HIGH
    sim.setInput('ir', 1);
    expect(await sim.digitalRead(7, false)).toBe(false);
    expect(changes).toBeGreaterThanOrEqual(3);
    sim.reset();
    expect(sim.getState().parts['bz']!.level).toBe(0);
    expect(sim.getState().pins).toEqual({});
  });

  it('reports the total supply current', async () => {
    const sim = new CircuitSimulator({ parts: [{ kind: 'resistor', id: 'r', label: 'resistor', a: '5V', b: 'GND', ohms: 500 }] }, uno);
    expect(sim.getState().supplyMilliamps).toBeCloseTo(10, 4);
  });
});
