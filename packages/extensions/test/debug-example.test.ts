/** Phase 8 exit check: the wrongly wired example is flagged. */
import { describe, expect, it } from 'vitest';
import { checkWiring, CircuitLayoutSchema, generateArduino, getBoard } from '@tariro-studio/core';
import { createRegistry, EXAMPLES } from '../src/index.js';

describe('"Find the wiring mistakes"', () => {
  it('has a valid workbench, and the circuit check finds both mistakes', () => {
    const ex = EXAMPLES.find((e) => e.name === 'find-the-wiring-mistakes')!;
    const layout = CircuitLayoutSchema.parse(ex.layout);
    const board = getBoard(ex.boards[0]!);
    const r = generateArduino(ex.workspace, board, createRegistry());
    expect(r.warnings).toEqual([]);
    const found = checkWiring(r.pins ?? [], layout, board);
    expect(found.map((p) => p.partId).sort()).toEqual(['button', 'led']);
    expect(found.find((p) => p.partId === 'led')!.message).toMatch(/in backwards/);
    expect(found.find((p) => p.partId === 'button')!.message).toMatch(/^Pin 2 floats .* Add a 10 kΩ resistor from pin 2 to GND \(a pull-down\)/);
  });

  it('is clean once the learner fixes it: LED turned round, a pull-down resistor on the button', () => {
    const ex = EXAMPLES.find((e) => e.name === 'find-the-wiring-mistakes')!;
    const board = getBoard('arduino-uno');
    // Turn the LED round: the pin goes to its long leg (column 5) and the resistor starts at column 6.
    const fixed = structuredClone(ex.layout!);
    fixed.wires.find((w) => w.id === 'w-led')!.to = 'bb:a5';
    fixed.parts.find((p) => p.id === 'resistor')!.col = 6;
    fixed.wires.find((w) => w.id === 'w-led-gnd')!.from = 'bb:a10';
    // 10 kΩ from the button's pin-2 column (14) to column 18, and column 18 to GND.
    fixed.parts.push({ id: 'pull-down', kind: 'resistor', row: 3, col: 14, rotation: 0, ohms: 10_000 });
    fixed.wires.push({ id: 'w-pull-down', from: 'bb:a18', to: 'pin:GND', colour: '#212121' });
    expect(checkWiring(generateArduino(ex.workspace, board, createRegistry()).pins!, fixed, board)).toEqual([]);
  });
});
