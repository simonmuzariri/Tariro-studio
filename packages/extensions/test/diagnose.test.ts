/** Phase 8d: guided diagnosis lists what it found first, then what it cannot check. */
import { describe, expect, it } from 'vitest';
import { checkWiring, diagnose, generateArduino, getBoard, type CircuitLayout, type DiagnoseEvidence, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, EXAMPLES } from '../src/index.js';
import { block, forever, n, program, workspace } from '../src/build.js';

const registry = createRegistry();
const uno = getBoard('arduino-uno');

function evidence(ws: WorkspaceJson, layout?: CircuitLayout, extra: Partial<DiagnoseEvidence> = {}, board = uno): DiagnoseEvidence {
  const r = generateArduino(ws, board, registry);
  return { board, workspace: ws, pins: r.pins ?? [], warnings: r.warnings, layout, wiring: layout ? checkWiring(r.pins ?? [], layout, board) : [], port: '/dev/ttyUSB0', ...extra };
}

describe('guided diagnosis', () => {
  it('puts what it found first: the wrongly wired example’s backwards LED and floating button', () => {
    const ex = EXAMPLES.find((e) => e.name === 'find-the-wiring-mistakes')!;
    const ev = evidence(ex.workspace, ex.layout);
    const led = diagnose('led', ev);
    expect(led[0]).toMatchObject({ found: true, title: 'The LED is in backwards', partId: 'led' });
    expect(led.filter((c) => c.found)).toHaveLength(1);
    expect(led.at(-1)!.found).toBe(false); // possibilities it cannot check come last
    const button = diagnose('button', ev);
    expect(button[0]).toMatchObject({ found: true, title: 'The pin floats while the button is up', partId: 'button' });
  });

  it('notices an LED wired to a pin the program never uses', () => {
    const layout: CircuitLayout = {
      version: 1,
      parts: [
        { id: 'led', kind: 'led', row: 1, col: 5, rotation: 0, colour: 'green' },
        { id: 'r', kind: 'resistor', row: 2, col: 6, rotation: 0, ohms: 220 },
      ],
      wires: [
        { id: 'w1', from: 'pin:12', to: 'bb:a5', colour: '#e53935' },
        { id: 'w2', from: 'bb:a10', to: 'pin:GND', colour: '#212121' },
      ],
    };
    const ws = workspace([program(forever(block('io_digital_write', { fields: { PIN: '13', STATE: 'HIGH' } })))]);
    const found = diagnose('led', evidence(ws, layout)).filter((c) => c.found);
    expect(found.map((c) => c.title)).toEqual(['The program never switches pin 12 on', 'The pin the program uses has nothing on it']);
  });

  it('finds a button read only once, outside any loop', () => {
    const ws = workspace([program(block('controls_if', { inputs: { IF0: block('sensor_button_pressed', { id: 'read', fields: { PIN: '2' } }) }, do: { DO0: [block('basic_led', { fields: { PIN: '13', STATE: 'ON' } })] } }))]);
    expect(diagnose('button', evidence(ws))[0]).toMatchObject({ found: true, title: 'The program reads the button only once', blockId: 'read' });
    // Inside "forever" it is not reported.
    const looped = workspace([program(forever(block('controls_if', { inputs: { IF0: block('sensor_button_pressed', { id: 'read', fields: { PIN: '2' } }) } })))]);
    expect(diagnose('button', evidence(looped)).filter((c) => c.found)).toEqual([]);
  });

  it('for a motor: the emergency stop, a low speed limit and a speed too small to start', () => {
    const tariro = getBoard('tariro');
    const ws = workspace([program(block('tariro_motor_run', { id: 'slow', fields: { MOTOR: 'A', DIRECTION: 'FORWARD' }, inputs: { SPEED: n(15) } }))]);
    const causes = diagnose('motor', evidence(ws, undefined, { estop: true, motorLimit: 30 }, tariro));
    expect(causes.filter((c) => c.found).map((c) => c.id)).toEqual(['estop', 'limit', 'slow:slow']);
    expect(causes.some((c) => !c.found && c.id === 'battery')).toBe(true);
    // Nothing found: only possibilities, said as such.
    const clean = diagnose('motor', evidence(workspace([program(block('tariro_motor_run', { fields: { MOTOR: 'A', DIRECTION: 'FORWARD' }, inputs: { SPEED: n(60) } }))]), undefined, { motorLimit: 100 }, tariro));
    expect(clean.every((c) => !c.found)).toBe(true);
  });

  it('for an upload: no port chosen, and a board that did not answer', () => {
    const ws = workspace([program()]);
    const causes = diagnose('upload', evidence(ws, undefined, { port: null, lastBuild: { ok: false, message: 'avrdude: stk500_recv(): programmer is not responding', diagnostics: 0 } }));
    expect(causes.filter((c) => c.found).map((c) => c.id)).toEqual(['no-port', 'no-answer']);
  });
});
