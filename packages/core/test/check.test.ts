/** Phase 8a: the circuit check compares the program's pins with the workbench wiring. */
import { describe, expect, it } from 'vitest';
import { checkWiring, getBoard, type CircuitLayout, type PinUse, type PlacedPart, type Wire } from '../src/index.js';

const uno = getBoard('arduino-uno');
let n = 0;
const wire = (from: string, to: string): Wire => ({ id: `w${++n}`, from, to, colour: '#212121' });
const part = (kind: PlacedPart['kind'], row: number, col: number, extra: Partial<PlacedPart> = {}): PlacedPart => ({ id: `${kind}-${++n}`, kind, row, col, rotation: 0, ...extra });
const layout = (parts: PlacedPart[], wires: Wire[]): CircuitLayout => ({ version: 1, board: true, breadboard: true, parts, wires });
const out = (pin: string): PinUse => ({ pin, mode: 'OUTPUT', blockId: `block-${pin}` });

/** Pin 13 → LED (columns 5–6) → 220 Ω (6–10) → GND, the right way round. */
const goodLed = () => {
  const led = part('led', 1, 5, { id: 'led', colour: 'red' });
  return layout([led, part('resistor', 2, 6, { ohms: 220 })], [wire('pin:13', 'bb:a5'), wire('bb:a10', 'pin:GND')]);
};

describe('circuit check', () => {
  it('finds nothing wrong with an LED and resistor wired the right way', () => {
    expect(checkWiring([out('13')], goodLed(), uno)).toEqual([]);
  });

  it('finds an LED in backwards', () => {
    // Pin 13 goes to the LED's short leg; the long leg goes through the resistor to GND.
    const l = layout([part('led', 1, 5, { id: 'led', colour: 'red' }), part('resistor', 2, 5, { ohms: 220 })], [wire('pin:13', 'bb:a6'), wire('bb:a9', 'pin:GND')]);
    expect(checkWiring([out('13')], l, uno)).toEqual([{ message: expect.stringMatching(/^Red LED 1 never lights: it is in backwards/), severity: 'warning', partId: 'led' }]);
  });

  it('finds an LED with no resistor, as an error', () => {
    const l = layout([part('led', 1, 5, { id: 'led', colour: 'red' })], [wire('pin:13', 'bb:a5'), wire('bb:a6', 'pin:GND')]);
    expect(checkWiring([out('13')], l, uno)).toEqual([{ message: expect.stringMatching(/^Red LED 1: \d+ mA is too much .* needs a resistor/), severity: 'error', partId: 'led' }]);
  });

  it('finds a pin the program uses with nothing wired to it', () => {
    expect(checkWiring([out('13'), out('9')], goodLed(), uno)).toEqual([
      { message: 'The program uses pin 9 as an output, but nothing on the workbench is wired to pin 9.', severity: 'warning', blockId: 'block-9' },
    ]);
  });

  /** Pin 2 → push button (columns 12 and 14) → `rail`. */
  const button = (rail: 'GND' | '5V') => layout([part('button', 1, 12, { id: 'btn' })], [wire('pin:2', 'bb:a12'), wire('bb:a14', `pin:${rail}`)]);

  it('finds an input that floats while the button is not pressed', () => {
    expect(checkWiring([{ pin: '2', mode: 'INPUT' }], button('GND'), uno)).toEqual([{ message: expect.stringMatching(/^Pin 2 floats while Push button 1 is not pressed.* Turn on the pull-up/), severity: 'warning', partId: 'btn' }]);
    // A button to 5V needs a pull-down instead.
    expect(checkWiring([{ pin: '2', mode: 'INPUT' }], button('5V'), uno)).toEqual([{ message: expect.stringMatching(/^Pin 2 floats .* \(a pull-down\)/), severity: 'warning', partId: 'btn' }]);
    // With the pull-up it is fine.
    expect(checkWiring([{ pin: '2', mode: 'INPUT_PULLUP' }], button('GND'), uno)).toEqual([]);
  });

  it('finds a pull-up button wired to 5V, which can never change the pin', () => {
    expect(checkWiring([{ pin: '2', mode: 'INPUT_PULLUP' }], button('5V'), uno)).toEqual([{ message: expect.stringMatching(/pull-up already holds the pin HIGH/), severity: 'warning', partId: 'btn' }]);
  });

  it('finds a button that would short an output pin', () => {
    expect(checkWiring([out('2')], button('GND'), uno)).toEqual([{ message: expect.stringMatching(/^Pressing Push button 1 joins pin 2 straight to GND while the program drives it/), severity: 'warning', partId: 'btn', blockId: 'block-2' }]);
  });

  it('finds an input with only an LED on it', () => {
    expect(checkWiring([{ pin: '13', mode: 'INPUT_PULLUP', blockId: 'b' }], goodLed(), uno)).toContainEqual({ message: expect.stringMatching(/^The program reads pin 13, but only Red LED 1 is wired there/), severity: 'warning', blockId: 'b' });
  });

  it('checks nothing on an empty bench, and leaves wiring errors to the workbench', () => {
    expect(checkWiring([out('13')], layout([], []), uno)).toEqual([]);
    const shorted = layout([part('led', 1, 5)], [wire('pin:5V', 'bb:a20'), wire('bb:b20', 'pin:GND')]);
    expect(checkWiring([out('13')], shorted, uno)).toEqual([]);
  });
});
