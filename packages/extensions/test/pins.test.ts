/** Phase 8a: pin conflicts the code generator reports. */
import { describe, expect, it } from 'vitest';
import { generateArduino, getBoard } from '@tariro-studio/core';
import { createRegistry } from '../src/index.js';
import { block, forever, program, workspace } from '../src/build.js';

const registry = createRegistry();
const led = (pin: string, id = `led-${pin}`) => block('basic_led', { id, fields: { PIN: pin, STATE: 'ON' } });
const ifPressed = (pin: string, id: string) => block('controls_if', { inputs: { IF0: block('sensor_button_pressed', { id, fields: { PIN: pin } }) }, do: { DO0: [led('13', `${id}-led`)] } });

describe('pin conflicts', () => {
  it('lists the pins a program sets up, and warns on a block that needs a pin set up differently', () => {
    const r = generateArduino(workspace([program(led('2'), forever(ifPressed('2', 'button')))]), getBoard('arduino-uno'), registry);
    expect(r.pins).toEqual([
      { pin: '2', mode: 'OUTPUT', blockId: 'led-2', blockType: 'basic_led' },
      { pin: '2', mode: 'INPUT_PULLUP', blockId: 'button', blockType: 'sensor_button_pressed' },
      { pin: '13', mode: 'OUTPUT', blockId: 'button-led', blockType: 'basic_led' },
    ]);
    expect(r.warnings).toContainEqual({ blockId: 'button', message: expect.stringMatching(/^Pin 2 is already set up as an output by another block, so it cannot also work as an input with pull-up here/) });
    // The generated code still has the first set-up only (and so the warning matters).
    expect(r.code.match(/pinMode\(2, /g)).toHaveLength(1);
  });

  it('says nothing when blocks use a pin the same way', () => {
    const r = generateArduino(workspace([program(led('5', 'a'), led('5', 'b'))]), getBoard('arduino-uno'), registry);
    expect(r.warnings).toEqual([]);
  });

  it('warns when another block uses a pin wired to the board’s own motor driver', () => {
    const tariro = getBoard('tariro');
    const pins = tariro.onboard!.find((p) => p.kind === 'dual-motor-driver')!.pins;
    const pin = String(pins['ENA']);
    const r = generateArduino(workspace([program(led(pin, 'on-motor-pin'), block('tariro_motor_run', { fields: { MOTOR: 'A', DIRECTION: 'FORWARD' }, inputs: { SPEED: block('math_number', { fields: { NUM: 50 } }) } }))]), tariro, registry);
    expect(r.warnings).toContainEqual({ blockId: 'on-motor-pin', message: expect.stringMatching(new RegExp(`^Pin ${pin} is wired to .*own motor driver \\(motor A\\)`)) });
    // The motor blocks themselves are not warned about.
    expect(r.warnings.filter((w) => w.blockId !== 'on-motor-pin' && /motor driver/.test(w.message))).toEqual([]);
  });

  it('knows the pins an encoder takes, so a button on the same pin is reported', () => {
    const r = generateArduino(
      workspace([program(block('enc_setup', { id: 'enc', fields: { ENCODER: 'LEFT', KIND: 'SINGLE', PIN_A: '2', PIN_B: '2' } }), block('basic_led', { id: 'led-on-2', fields: { PIN: '2', STATE: 'ON' } }))]),
      getBoard('arduino-uno'),
      registry,
    );
    expect(r.warnings).toContainEqual({ blockId: 'led-on-2', message: expect.stringMatching(/^Pin 2 is already set up as an input with pull-up/) });
  });
});
