/** Phase 8b: the schematic is laid out from the same circuit as the breadboard. */
import { describe, expect, it } from 'vitest';
import { analyseLayout, buildSchematic, getBoard, type Part } from '../src/index.js';

const uno = getBoard('arduino-uno');

describe('schematic', () => {
  it('draws a pin → resistor → LED → GND chain as one row, in order', () => {
    const parts: Part[] = [
      { kind: 'led', id: 'led', label: 'Red LED 1', anode: 'net:1', cathode: 'GND', colour: 'red' },
      { kind: 'resistor', id: 'r', label: '220 Ω resistor 1', a: 'D13', b: 'net:1', ohms: 220 },
    ];
    expect(buildSchematic(parts, uno)).toEqual({
      rows: [
        {
          from: { kind: 'pin', label: 'pin 13', node: 'D13' },
          items: [
            { partId: 'r', kind: 'resistor', label: '220 Ω resistor 1', reversed: false },
            { partId: 'led', kind: 'led', label: 'Red LED 1', reversed: false },
          ],
          to: { kind: 'gnd', label: 'GND', node: 'GND' },
        },
      ],
      others: [],
    });
  });

  it('shows an LED in backwards as reversed, from the workbench of the wrongly wired example', () => {
    // Pin 13 → LED short leg; long leg → resistor → GND (the same wiring as the example).
    const layout = {
      version: 1 as const,
      board: true,
      breadboard: true,
      parts: [
        { id: 'led', kind: 'led' as const, row: 1, col: 5, rotation: 0 as const, colour: 'red' as const },
        { id: 'resistor', kind: 'resistor' as const, row: 2, col: 5, rotation: 0 as const, ohms: 220 },
      ],
      wires: [
        { id: 'w1', from: 'pin:13', to: 'bb:a6', colour: '#e53935' },
        { id: 'w2', from: 'bb:a9', to: 'pin:GND', colour: '#212121' },
      ],
    };
    const s = buildSchematic(analyseLayout(layout, uno).circuit.parts, uno);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]!.items.map((i) => [i.partId, i.reversed])).toEqual([
      ['led', true],
      ['resistor', false],
    ]);
    expect(s.rows[0]!.to.kind).toBe('gnd');
  });

  it('gives a potentiometer and a branching point labels on their legs', () => {
    const parts: Part[] = [
      { kind: 'potentiometer', id: 'pot', label: 'Potentiometer 1', high: '5V', wiper: 'D14', low: 'GND', ohms: 10_000 },
      // Two LEDs from one point: the chain stops there, and each goes on as its own row.
      { kind: 'resistor', id: 'r', label: '220 Ω resistor 1', a: 'D9', b: 'net:x', ohms: 220 },
      { kind: 'led', id: 'l1', label: 'Red LED 1', anode: 'net:x', cathode: 'GND', colour: 'red' },
      { kind: 'led', id: 'l2', label: 'Green LED 1', anode: 'net:x', cathode: 'GND', colour: 'green' },
    ];
    const s = buildSchematic(parts, uno);
    expect(s.rows[0]).toMatchObject({ from: { label: 'pin 9' }, items: [{ partId: 'r' }], to: { kind: 'net', label: 'point 1' } });
    expect(s.others.find((o) => o.partId === 'pot')!.legs).toEqual([
      { leg: 'end 1', to: { kind: 'gnd', label: 'GND', node: 'GND' } },
      { leg: 'wiper', to: { kind: 'pin', label: 'pin A0', node: 'D14' } },
      { leg: 'end 2', to: { kind: '5v', label: '5V', node: '5V' } },
    ]);
    expect(s.others.filter((o) => o.kind === 'led').map((o) => o.legs.map((l) => l.to.label))).toEqual([
      ['point 1', 'GND'],
      ['point 1', 'GND'],
    ]);
  });
});
