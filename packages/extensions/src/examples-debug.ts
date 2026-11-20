/**
 * Phase 8 example: a circuit with two wiring mistakes on the workbench for the learner to find.
 * The circuit check flags both before anything runs.
 */
import type { CircuitLayout } from '@tariro-studio/core';
import type { ExampleProject } from './examples.js';
import { block, forever, program, workspace } from './build.js';

const wire = (id: string, from: string, to: string, colour: string) => ({ id, from, to, colour });

/**
 * Pin 13 → the LED's short leg (it is in backwards) and its long leg → 220 Ω → GND; pin 2 → a push
 * button → 5V, with no pull-down resistor (so the pin floats while the button is up).
 */
const layout: CircuitLayout = {
  version: 1,
  board: true,
  breadboard: true,
  parts: [
    { id: 'led', kind: 'led', row: 1, col: 5, rotation: 0, colour: 'red' },
    { id: 'resistor', kind: 'resistor', row: 2, col: 5, rotation: 0, ohms: 220 },
    { id: 'button', kind: 'button', row: 1, col: 14, rotation: 0 },
  ],
  wires: [
    wire('w-led', 'pin:13', 'bb:a6', '#e53935'),
    wire('w-led-gnd', 'bb:a9', 'pin:GND', '#212121'),
    wire('w-button', 'pin:2', 'bb:a14', '#1e88e5'),
    wire('w-button-5v', 'bb:a16', 'pin:5V', '#e53935'),
  ],
};

export const DEBUG_EXAMPLES: ExampleProject[] = [
  {
    name: 'find-the-wiring-mistakes',
    title: 'Find the wiring mistakes',
    description: 'The LED should light while the button is pressed, but the circuit on the workbench has two mistakes. The circuit check points them out: can you fix them?',
    kit: 'Starter',
    boards: ['arduino-uno'],
    workspace: workspace([
      program(
        forever(
          block('controls_if', {
            extraState: { hasElse: true },
            inputs: { IF0: block('io_digital_read', { fields: { PIN: '2', PULL: 'INPUT' } }) },
            do: { DO0: [block('io_digital_write', { fields: { PIN: '13', STATE: 'HIGH' } })], ELSE: [block('io_digital_write', { fields: { PIN: '13', STATE: 'LOW' } })] },
          }),
        ),
      ),
    ]),
    layout,
  },
];
