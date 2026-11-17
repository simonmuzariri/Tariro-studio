import { describe, expect, it } from 'vitest';
import {
  analyseLayout,
  canPlace,
  CircuitSimulator,
  emptyLayout,
  firstFreeSpot,
  freeHoleInStrip,
  getBoard,
  holePosition,
  layoutFromCircuit,
  legHoles,
  nearestHole,
  pinPosition,
  newProject,
  encodeProject,
  decodeProject,
  type CircuitLayout,
  type PlacedPart,
  type Wire,
} from '../src/index.js';

const uno = getBoard('arduino-uno');
let n = 0;
const part = (p: Omit<PlacedPart, 'id'>): PlacedPart => ({ id: `p-${++n}`, ...p });
const wire = (from: string, to: string): Wire => ({ id: `w-${++n}`, from, to, colour: '#e53935' });
const layout = (parts: PlacedPart[], wires: Wire[]): CircuitLayout => ({ version: 1, parts, wires });

/** LED on pin 13 through a 220 Ω resistor, built the way a learner would on the breadboard. */
const ledCircuit = () =>
  layout(
    [part({ kind: 'resistor', row: 1, col: 3, rotation: 0, ohms: 220 }), part({ kind: 'led', row: 2, col: 7, rotation: 0, colour: 'green' })],
    [wire('pin:13', 'bb:a3'), wire('bb:d8', 'bb:top-8'), wire('pin:GND', 'bb:top-30')],
  );

describe('breadboard geometry', () => {
  it('places legs along a row or down a column, and refuses legs off the edge', () => {
    expect(legHoles({ kind: 'resistor', row: 0, col: 1, rotation: 0 })).toEqual(['bb:a1', 'bb:a5']);
    expect(legHoles({ kind: 'potentiometer', row: 3, col: 10, rotation: 90 })).toEqual(['bb:d10', 'bb:e10', 'bb:f10']);
    expect(legHoles({ kind: 'resistor', row: 0, col: 28, rotation: 0 })).toBeUndefined();
  });

  it('holes are 2.54 mm apart, with the centre gap and rails further out', () => {
    const [a1, a2, e1, f1] = ['bb:a1', 'bb:a2', 'bb:e1', 'bb:f1'].map((h) => holePosition(h)!);
    expect(a2!.x - a1!.x).toBeCloseTo(2.54, 6);
    expect(f1!.z - e1!.z).toBeCloseTo(2.54 * 3, 6); // rows e and f are 0.3 inch apart across the gap
    expect(holePosition('bb:top+1')!.z).toBeLessThan(a1!.z);
    expect(holePosition('bb:bot-1')!.z).toBeGreaterThan(holePosition('bb:j1')!.z);
    expect(nearestHole(a1!.x + 0.4, a1!.z - 0.3)).toBe('bb:a1');
    expect(nearestHole(500, 500)).toBeUndefined();
    expect(pinPosition(uno, 'pin:13')).toBeDefined();
    expect(pinPosition(uno, 'pin:99')).toBeUndefined();
  });
});

describe('connectivity', () => {
  it('joins a column strip, rails and wires, and names groups after the board pin they reach', () => {
    const a = analyseLayout(ledCircuit(), uno);
    expect(a.problems).toEqual([]);
    expect(a.nodeAt('bb:e3')).toBe('D13'); // same strip as a3, wired to pin 13
    expect(a.nodeAt('bb:a8')).toBe('GND'); // LED short leg strip → rail → GND
    expect(a.nodeAt('bb:bot+4')).toBeUndefined(); // nothing on that rail
    expect(a.nodeAt('bb:top-15')).toBe('GND');
    const led = a.circuit.parts.find((p) => p.kind === 'led')!;
    expect(led).toMatchObject({ kind: 'led', label: 'Green LED 1', cathode: 'GND', colour: 'green' });
    expect(a.circuit.parts.find((p) => p.kind === 'resistor')).toMatchObject({ a: 'D13', ohms: 220, label: '220 Ω resistor 1' });
  });

  it('the hand-built circuit lights when the program drives pin 13', async () => {
    const sim = new CircuitSimulator(analyseLayout(ledCircuit(), uno).circuit, uno);
    await sim.digitalWrite(13, true);
    const led = Object.values(sim.getState().parts).find((s) => s.milliamps > 1);
    expect(led!.milliamps).toBeGreaterThan(11);
    expect(led!.milliamps).toBeLessThan(14); // green drops a little more than red
  });

  it('rows a–e and f–j are separate: the gap breaks the column', () => {
    const a = analyseLayout(layout([], [wire('pin:2', 'bb:e5'), wire('pin:3', 'bb:f5')]), uno);
    expect(a.nodeOf.get('bb:e5')).toBe('D2');
    expect(a.nodeOf.get('bb:f5')).toBe('D3');
  });

  it('explains common mistakes', () => {
    const shorted = analyseLayout(layout([part({ kind: 'led', row: 0, col: 4, rotation: 90 })], []), uno);
    expect(shorted.problems[0]).toMatchObject({ severity: 'warning' });
    expect(shorted.problems[0]!.message).toContain('shorted out');

    const short = analyseLayout(layout([], [wire('pin:5V', 'bb:top+1'), wire('pin:GND', 'bb:top+9')]), uno);
    expect(short.problems).toContainEqual({ message: 'Short circuit: 5V is wired straight to GND. Remove that wire before running.', severity: 'error' });

    const fight = analyseLayout(layout([], [wire('pin:7', 'bb:a1'), wire('pin:8', 'bb:c1')]), uno);
    expect(fight.problems[0]!.message).toContain('Pins 7 and 8 are wired together');

    const p1 = part({ kind: 'resistor', row: 0, col: 1, rotation: 0 });
    const clash = analyseLayout(layout([p1, part({ kind: 'led', row: 0, col: 5, rotation: 0 })], []), uno);
    expect(clash.problems.some((p) => p.message.includes('same hole') && p.severity === 'error')).toBe(true);

    expect(analyseLayout(layout([], [wire('pin:A9', 'bb:a1')]), uno).problems[0]!.message).toBe('Arduino Uno has no pin A9.');
  });
});

describe('editing helpers', () => {
  it('finds free places that do not share a strip with other parts', () => {
    const l = emptyLayout();
    const s1 = firstFreeSpot(l, 'led')!;
    l.parts.push({ id: 'a', kind: 'led', ...s1 });
    const s2 = firstFreeSpot(l, 'led')!;
    expect(s2.col).toBeGreaterThan(s1.col + 1);
    expect(canPlace(l, { kind: 'resistor', row: 0, col: 1, rotation: 0 })).toBe(false);
    expect(freeHoleInStrip(l, 'bb:a1')).toBe('bb:b1');
  });
});

describe('from blocks to the breadboard', () => {
  it('lays out an LED with its resistor, a button and a potentiometer that simulate like the original', async () => {
    const original = {
      parts: [
        { kind: 'resistor' as const, id: 'r', label: 'r', a: 'D9', b: 'mid', ohms: 220 },
        { kind: 'led' as const, id: 'led', label: 'LED', anode: 'mid', cathode: 'GND', colour: 'red' as const },
        { kind: 'button' as const, id: 'b', label: 'button', a: 'D2', b: 'GND' },
        { kind: 'potentiometer' as const, id: 'pot', label: 'pot', high: '5V', wiper: 'D14', low: 'GND', ohms: 10_000 },
        { kind: 'motor' as const, id: 'm', label: 'Motor A', direction: 'D4', speed: 'D5' },
      ],
    };
    const { layout: built, skipped } = layoutFromCircuit(original, uno);
    expect(skipped).toEqual(['Motor A']);
    const a = analyseLayout(built, uno);
    expect(a.problems).toEqual([]);
    const sim = new CircuitSimulator(a.circuit, uno);
    await sim.digitalWrite(9, true);
    const led = a.circuit.parts.find((p) => p.kind === 'led')!;
    expect(sim.getState().parts[led.id]!.milliamps).toBeGreaterThan(12);
    const button = a.circuit.parts.find((p) => p.kind === 'button')!;
    expect(await sim.digitalRead(2, true)).toBe(true);
    sim.setInput(button.id, 1);
    expect(await sim.digitalRead(2, true)).toBe(false);
    const pot = a.circuit.parts.find((p) => p.kind === 'potentiometer')!;
    sim.setInput(pot.id, 1);
    expect(await sim.analogRead(0)).toBeGreaterThan(1015);
  });
});

describe('project file', () => {
  it('saves and reopens the workbench, and older projects without one still open', () => {
    const p = { ...newProject({ board: 'arduino-uno', workspace: {}, appVersion: '0.1.0' }), circuit: ledCircuit() };
    const back = decodeProject(encodeProject(p));
    expect(back.project.circuit).toEqual(p.circuit);
    const old = decodeProject(encodeProject(newProject({ board: 'arduino-uno', workspace: {}, appVersion: '0.1.0' })));
    expect(old.project.circuit).toBeUndefined();
  });
});
