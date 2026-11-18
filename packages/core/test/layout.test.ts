import { describe, expect, it } from 'vitest';
import {
  analyseLayout,
  boardPlacement,
  ON_CHASSIS,
  ON_TABLE,
  benchConnectors,
  boardPinOrder,
  canonicalPin,
  SMRS_PINS,
  MALKON_ONE_PINS,
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

describe('the Malkon SMRS board on the workbench', () => {
  const tariro = getBoard('tariro');

  it('offers only the pins its headers bring out (the motor driver has D4–D7)', () => {
    expect(boardPinOrder(tariro)).toEqual(['2', '3', '10', '11', '12', '13', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', '5V', 'GND']);
    expect(pinPosition(tariro, 'pin:9')).toBeUndefined();
  });

  it('puts the pins where the pinout has them: D12–D13 and D2–D3 at the back, A0–A5 at the front', () => {
    const at = (p: string) => pinPosition(tariro, `pin:${p}`)!;
    expect(at('13').x).toBeLessThan(at('12').x); // top-left header reads 5V GND D13 D12 5V GND
    expect(at('12').x).toBeLessThan(at('10').x);
    expect(at('11').x).toBeLessThan(at('2').x);
    expect(at('2').x).toBeLessThan(at('3').x);
    expect(at('A0').z).toBeGreaterThan(at('13').z + 40); // the analog header is on the far edge, near the breadboard
    for (let i = 0; i < 5; i++) expect(at(`A${i + 1}`).x).toBeGreaterThan(at(`A${i}`).x);
    // Every wireable pin has its own place.
    const spots = new Set(SMRS_PINS.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`));
    expect(spots.size).toBe(SMRS_PINS.length);
  });

  it('treats every 5V and every GND pin as the same pin', () => {
    expect(benchConnectors(tariro)).toContain('GNDx12');
    expect(canonicalPin('GNDx7')).toBe('GND');
    expect(canonicalPin('5Vx3')).toBe('5V');
    expect(canonicalPin('A5')).toBe('A5');
    const l = layout(
      [part({ kind: 'resistor', row: 1, col: 3, rotation: 0, ohms: 220 }), part({ kind: 'led', row: 2, col: 7, rotation: 0, colour: 'red' })],
      [wire('pin:13', 'bb:a3'), wire('bb:d8', 'bb:top-8'), wire('pin:GNDx9', 'bb:top-30')],
    );
    const a = analyseLayout(l, tariro);
    expect(a.problems).toEqual([]);
    expect(a.nodeOf.get('bb:d8')).toBe('GND');
    expect(a.nodeAt('pin:5Vx4')).toBe('5V');
    // A short between two differently numbered pins is still a short.
    const short = analyseLayout(layout([], [wire('pin:5Vx2', 'bb:top+3'), wire('pin:GNDx5', 'bb:top+9')]), tariro);
    expect(short.problems[0]?.message).toMatch(/Short circuit/);
  });

  it('building from blocks leaves out parts on pins the board has no header pin for', () => {
    const built = layoutFromCircuit(
      {
        parts: [
          { kind: 'led', id: 'a', label: 'Red LED 1', anode: 'D9', cathode: 'GND', colour: 'red' },
          { kind: 'led', id: 'b', label: 'Red LED 2', anode: 'D13', cathode: 'GND', colour: 'red' },
        ],
      },
      tariro,
    );
    expect(built.skipped).toEqual(['Red LED 1']);
    expect(built.layout.wires.some((w) => w.from === 'pin:13')).toBe(true);
    expect(analyseLayout(built.layout, tariro).problems.filter((p) => p.severity === 'error')).toEqual([]);
  });
});

describe('the Malkon One board on the workbench', () => {
  const one = getBoard('malkon-one');
  const at = (p: string) => pinPosition(one, `pin:${p}`)!;

  it('brings out every digital and analog pin, with the digital header facing the breadboard', () => {
    expect(boardPinOrder(one)).toEqual([...Array.from({ length: 14 }, (_, i) => String(i)), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', '5V', 'GND']);
    for (let i = 0; i < 13; i++) expect(at(String(i + 1)).x).toBeGreaterThan(at(String(i)).x); // D0 on the left
    expect(at('13').z).toBeGreaterThan(at('A0').z + 40); // the analog header is at the back
    for (let i = 0; i < 5; i++) expect(at(`A${i + 1}`).x).toBeLessThan(at(`A${i}`).x); // A5 … A0 from the left
  });

  it('SDA and SCL on the digital header are A4 and A5', () => {
    expect(benchConnectors(one)).toEqual(expect.arrayContaining(['A4x2', 'A5x2', 'GNDx2', '5Vx2']));
    const l = layout([part({ kind: 'potentiometer', row: 2, col: 3, rotation: 0 })], [wire('pin:A4x2', 'bb:a4'), wire('pin:5Vx7', 'bb:a5'), wire('pin:GNDx3', 'bb:a3')]);
    const a = analyseLayout(l, one);
    expect(a.problems).toEqual([]);
    expect(a.nodeOf.get('bb:a4')).toBe(a.nodeAt('pin:A4'));
    expect(new Set(MALKON_ONE_PINS.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)).size).toBe(MALKON_ONE_PINS.length);
  });
});

describe('the DC motor on the workbench', () => {
  const motor = (col: number) => part({ kind: 'dc-motor', row: 0, col, rotation: 0 });
  const run = (l: CircuitLayout) => {
    const a = analyseLayout(l, uno);
    expect(a.problems.filter((p) => p.severity === 'error')).toEqual([]);
    return { sim: new CircuitSimulator(a.circuit, uno), a };
  };

  it('turns forward with red on 5V and black on GND, and backwards the other way round', () => {
    const m = motor(10);
    const fwd = run(layout([m], [wire('pin:5V', 'bb:b10'), wire('pin:GND', 'bb:b11')])).sim.getState().parts[m.id]!;
    expect(fwd.level).toBe(1);
    expect(fwd.milliamps).toBeGreaterThan(100); // far more than a pin can give
    const back = run(layout([m], [wire('pin:GND', 'bb:b10'), wire('pin:5V', 'bb:b11')])).sim.getState().parts[m.id]!;
    expect(back.level).toBe(-1);
  });

  it('wired straight to a pin it turns slowly, and both the motor and the pin say why that is wrong', async () => {
    const m = motor(10);
    const { sim } = run(layout([m], [wire('pin:9', 'bb:b10'), wire('pin:GND', 'bb:b11')]));
    await sim.digitalWrite(9, true);
    const s = sim.getState();
    expect(s.parts[m.id]!.level).toBeGreaterThan(0);
    expect(s.parts[m.id]!.level).toBeLessThan(0.6); // the pin's own resistance takes half the voltage
    expect(s.problems.join(' ')).toMatch(/a pin cannot power a motor/);
    expect(s.problems.join(' ')).toMatch(/Pin 9 carries \d+ mA/);
    await sim.digitalWrite(9, false);
    expect(sim.getState().parts[m.id]!.level).toBe(0);
  });
});

describe('motors on the Malkon SMRS motor terminals', () => {
  const tariro = getBoard('tariro');
  const onA = () => part({ kind: 'dc-motor', row: 0, col: 1, rotation: 0, terminal: 'A' });

  it('a motor on Motor A is driven by the board: D4 sets the direction, the duty on D5 the speed', async () => {
    const m = onA();
    const a = analyseLayout(layout([m], []), tariro);
    expect(a.problems).toEqual([]);
    expect(a.circuit.parts.map((p) => p.kind)).toEqual(['dc-motor', 'h-bridge']);
    const sim = new CircuitSimulator(a.circuit, tariro);
    expect(sim.getState().parts[m.id]!.level).toBe(0); // nothing driven: stopped
    await sim.digitalWrite(4, true);
    await sim.analogWrite(5, 255);
    const full = sim.getState();
    expect(full.parts[m.id]!.level).toBeGreaterThan(0.95);
    expect(full.problems).toEqual([]); // the driver carries the motor's current, not the pins
    await sim.analogWrite(5, 128);
    const half = sim.getState().parts[m.id]!.level;
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.5);
    await sim.digitalWrite(4, false);
    expect(sim.getState().parts[m.id]!.level).toBeCloseTo(-half, 5); // backwards
    await sim.analogWrite(5, 0);
    expect(sim.getState().parts[m.id]!.level).toBe(0);
  });

  it('Motor B uses D7 and D6; two motors on one terminal are refused', async () => {
    const b = part({ kind: 'dc-motor', row: 0, col: 1, rotation: 0, terminal: 'B' });
    const sim = new CircuitSimulator(analyseLayout(layout([b], []), tariro).circuit, tariro);
    await sim.digitalWrite(7, true);
    await sim.analogWrite(6, 255);
    expect(sim.getState().parts[b.id]!.level).toBeGreaterThan(0.95);
    expect(analyseLayout(layout([onA(), onA()], []), tariro).problems[0]?.message).toMatch(/same motor terminal \(A\)/);
  });

  it('building the drive blocks puts a motor on each terminal', () => {
    const built = layoutFromCircuit(
      {
        parts: [
          { kind: 'motor', id: 'motor:A', label: 'Motor A (left)', direction: 'D4', speed: 'D5' },
          { kind: 'motor', id: 'motor:B', label: 'Motor B (right)', direction: 'D7', speed: 'D6' },
        ],
      },
      tariro,
    );
    expect(built.skipped).toEqual([]);
    expect(built.layout.parts.map((p) => p.terminal)).toEqual(['A', 'B']);
    expect(pinPosition(tariro, 'pin:MA1')!.x).toBeGreaterThan(pinPosition(tariro, 'pin:3')!.x); // on the right edge
  });
});

describe('the robot car chassis', () => {
  const tariro = getBoard('tariro');
  const car = () => part({ kind: 'chassis', row: 0, col: 1, rotation: 0 });

  it('puts the board on its deck: further back and lifted, with every pin moving with it', () => {
    const l = layout([car()], []);
    const place = boardPlacement(l);
    expect(place).toEqual(ON_CHASSIS);
    expect(place.lift).toBeGreaterThan(40);
    const table = pinPosition(tariro, 'pin:13')!;
    const deck = pinPosition(tariro, 'pin:13', place)!;
    expect(deck.x).toBe(table.x);
    expect(deck.z - table.z).toBeCloseTo(place.z - ON_TABLE.z, 9);
    expect(boardPlacement(layout([], []))).toEqual(ON_TABLE);
  });

  it('carries the motors on the terminals; one chassis only', async () => {
    const a = part({ kind: 'dc-motor', row: 0, col: 1, rotation: 0, terminal: 'A' });
    const an = analyseLayout(layout([car(), a], []), tariro);
    expect(an.problems).toEqual([]);
    expect(an.circuit.parts.map((p) => p.kind)).toEqual(['dc-motor', 'h-bridge']); // the chassis itself is not electrical
    expect(analyseLayout(layout([car(), car()], []), tariro).problems[0]?.message).toMatch(/two robot car chassis/);
  });
});
