/** The workbench: boards placed and turned anywhere, the breadboard moved, wires bent; real Arduino layouts. */
import { describe, expect, it } from 'vitest';
import { benchOverlap, separateBoard, type CircuitLayout, allHoles, analyseLayout, canPlace, columnsOf, firstFreeSpot, fromBreadboard, holePosition, placeOnBreadboard, benchConnectors, benchModel, boardPlacement, CircuitLayoutSchema, connectionPosition, getBoard, MEGA_PINS, NANO_PINS, ON_TABLE, pinPosition, UNO_PINS, BOARDS } from '../src/index.js';

const uno = getBoard('arduino-uno');

describe('boards on the bench', () => {
  it('every board has a bench model, with real layouts for the Tariro, Malkon One, Uno, Nano and Mega', () => {
    expect(BOARDS.map((b) => [b.id, benchModel(b)])).toEqual([
      ['tariro', 'smrs'],
      ['malkon-one', 'malkon-one'],
      ['malkon-esp32s3', 'generic'],
      ['arduino-uno', 'uno'],
      ['arduino-nano', 'nano'],
      ['arduino-mega', 'mega'],
    ]);
  });

  it('lays the Uno out like the real board: D0–D13 along the back, power and A0–A5 along the front', () => {
    const at = (id: string) => UNO_PINS.find((p) => p.id === id)!;
    expect(at('0').z).toBeCloseTo(at('13').z, 5); // one edge
    expect(at('A0').z).toBeGreaterThan(20); // the other edge, towards the learner
    expect(at('0').x).toBeGreaterThan(at('7').x); // D0 on the right
    expect(at('8').x - at('7').x).toBeCloseTo(-4.06, 1); // the 0.06" gap between D7 and D8
    // A4 is the analog socket; the copy brought out as SDA is A4x2.
    expect(at('A4').z).toBeCloseTo(at('A0').z, 5);
    expect(at('A4x2').z).toBeCloseTo(at('13').z, 5);
    for (const pin of [...uno.pins.digital.map(String), ...uno.pins.analog, '5V', 'GND']) expect(benchConnectors(uno), pin).toContain(pin);
  });

  it('knows the Mega’s SDA and SCL are D20 and D21, and the Nano has two rows', () => {
    expect(MEGA_PINS.find((p) => p.id === '20x2')!.header).toMatch(/SDA = D20/);
    expect(MEGA_PINS.some((p) => p.id === '53')).toBe(true);
    expect(MEGA_PINS.some((p) => p.id === 'A15')).toBe(true);
    expect(new Set(NANO_PINS.map((p) => Math.round(p.z))).size).toBe(2);
  });

  it('moves and turns the pins with the board', () => {
    const home = pinPosition(uno, 'pin:13', ON_TABLE)!;
    const moved = pinPosition(uno, 'pin:13', { x: 100, z: 20, lift: 0, turn: 0 })!;
    expect(moved.x - home.x).toBeCloseTo(100, 5);
    expect(moved.z - home.z).toBeCloseTo(20 - ON_TABLE.z, 5);
    // A quarter turn swaps across and along: a pin at the back (−z) goes to the left (−x).
    const local = UNO_PINS.find((p) => p.id === '13')!;
    const turned = pinPosition(uno, 'pin:13', { x: 0, z: 0, lift: 0, turn: 1 })!;
    expect(turned.x).toBeCloseTo(local.z, 5);
    expect(turned.z).toBeCloseTo(-local.x, 5);
    // Four turns come back round.
    expect(pinPosition(uno, 'pin:13', { x: 0, z: 0, lift: 0, turn: 4 % 4 })!.x).toBeCloseTo(local.x, 5);
  });

  it('keeps old projects as they were, and saves where the board, breadboard and wire bends are', () => {
    const old = CircuitLayoutSchema.parse({ version: 1, parts: [], wires: [{ id: 'w', from: 'pin:13', to: 'bb:a5', colour: '#212121' }] });
    expect(boardPlacement(old)).toEqual(ON_TABLE);
    const moved = CircuitLayoutSchema.parse({
      version: 1,
      parts: [],
      boardAt: { x: 120, z: -30, turn: 3 },
      breadboardAt: { x: -40, z: 15 },
      wires: [{ id: 'w', from: 'pin:13', to: 'bb:a5', colour: '#212121', via: [{ x: 10, z: -20 }] }],
    });
    expect(boardPlacement(moved)).toEqual({ x: 120, z: -30, lift: 0, turn: 3 });
    // A hole moves with the breadboard.
    expect(connectionPosition(uno, 'bb:a5', boardPlacement(moved), moved.breadboardAt)!.x - connectionPosition(uno, 'bb:a5')!.x).toBeCloseTo(-40, 5);
    expect(() => CircuitLayoutSchema.parse({ ...moved, boardAt: { x: 0, z: 0, turn: 4 } })).toThrow();
    // On the robot car the board rides on its deck, wherever it was put before.
    expect(boardPlacement({ ...moved, parts: [{ id: 'car', kind: 'chassis', row: 0, col: 1, rotation: 0 }] }).lift).toBeGreaterThan(0);
  });
});

describe('breadboard sizes and turns', () => {
  it('a full-size breadboard has 63 columns (830 holes); a half-size one 30 (400 holes, the default)', () => {
    const half = CircuitLayoutSchema.parse({ version: 1, parts: [], wires: [] });
    const full = CircuitLayoutSchema.parse({ version: 1, breadboardSize: 'full', parts: [], wires: [] });
    expect(columnsOf(half)).toBe(30);
    expect(columnsOf(full)).toBe(63);
    // 10 terminal holes per column (the names "400" and "830" also count the power rails).
    expect(allHoles(30).filter((h) => /^bb:[a-j]\d/.test(h))).toHaveLength(300);
    expect(allHoles(63).filter((h) => /^bb:[a-j]\d/.test(h))).toHaveLength(630);
    // Holes keep their place: column 1 is where it was, the full board carries on to the right.
    expect(holePosition('bb:a40')!.x).toBeGreaterThan(holePosition('bb:a30')!.x);
    const led = { kind: 'led' as const, row: 0, col: 45, rotation: 0 as const };
    expect(canPlace(half, led)).toBe(false);
    expect(canPlace(full, led)).toBe(true);
    expect(firstFreeSpot({ ...full, parts: [] }, 'led')).toEqual({ row: 0, col: 1, rotation: 0 });
    // A wire to hole j60 is valid in a project, and a part out there hangs off a half-size board.
    expect(() => CircuitLayoutSchema.parse({ version: 1, parts: [], wires: [{ id: 'w', from: 'bb:j60', to: 'pin:13', colour: '#212121' }] })).not.toThrow();
    const off = analyseLayout({ ...half, parts: [{ id: 'l', ...led }] }, uno);
    expect(off.problems[0]!.message).toMatch(/hangs off the edge/);
    expect(analyseLayout({ ...full, parts: [{ id: 'l', ...led }] }, uno).problems).toEqual([]);
  });

  it('turns the breadboard about its own centre, and finds holes back from the table', () => {
    for (const cols of [30, 63])
      for (const turn of [0, 1, 2, 3]) {
        const bb = { x: 25, z: -10, turn, cols };
        const h = holePosition('bb:c12')!;
        const onTable = placeOnBreadboard(bb, h.x, h.z);
        const back = fromBreadboard(bb, onTable.x, onTable.z);
        expect(back.x).toBeCloseTo(h.x, 6);
        expect(back.z).toBeCloseTo(h.z, 6);
      }
    // A half turn puts row a (back) at the front.
    const a = placeOnBreadboard({ x: 0, z: 0, turn: 2, cols: 30 }, holePosition('bb:a1')!.x, holePosition('bb:a1')!.z);
    expect(a.z).toBeGreaterThan(0);
    expect(connectionPosition(uno, 'bb:a1', ON_TABLE, { x: 0, z: 0, turn: 2, cols: 30 })).toEqual(a);
  });
});

describe('the board stays off the breadboard', () => {
  const bench = (extra: Partial<CircuitLayout> = {}): CircuitLayout => ({ version: 1, board: true, breadboard: true, parts: [], wires: [], ...extra });

  it('no board overlaps the breadboard in its usual place, half or full size', () => {
    for (const b of BOARDS) for (const size of ['half', 'full'] as const) expect(benchOverlap(bench({ breadboardSize: size }), b), `${b.id} ${size}`).toBe(false);
  });

  it('a turn that puts the breadboard under the Tariro board moves the board the shortest way off it, in one step', () => {
    const tariro = getBoard('tariro');
    const turned = bench({ breadboardAt: { x: 0, z: 0, turn: 1 } });
    expect(benchOverlap(turned, tariro)).toBe(true);
    const fixed = separateBoard(turned, tariro);
    expect(benchOverlap(fixed, tariro)).toBe(false);
    expect(fixed.breadboardAt).toEqual(turned.breadboardAt); // the breadboard stays where the learner turned it
    expect(fixed.boardAt!.turn).toBe(0);
    // Nothing to do: the same object back.
    const fine = bench();
    expect(separateBoard(fine, tariro)).toBe(fine);
    // On the robot car the board rides above the breadboard: no overlap.
    expect(benchOverlap({ ...turned, parts: [{ id: 'car', kind: 'chassis', row: 0, col: 1, rotation: 0 }] }, tariro)).toBe(false);
  });

  it('works for every board, turned or not, on a turned full-size breadboard', () => {
    for (const b of BOARDS)
      for (const turn of [0, 1]) {
        const l = bench({ breadboardSize: 'full', breadboardAt: { x: 10, z: -20, turn: 1 }, boardAt: { x: 0, z: -40, turn } });
        expect(benchOverlap(separateBoard(l, b), b), `${b.id} turn ${turn}`).toBe(false);
      }
  });
});
