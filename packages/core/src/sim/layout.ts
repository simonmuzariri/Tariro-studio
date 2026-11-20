/**
 * The workbench: parts placed on a breadboard and wires between breadboard holes and board pins.
 * This module owns the geometry (shared with the 3D view) and the electrical rules that turn a
 * layout into a circuit the simulator can solve.
 *
 * Breadboard (half size, 30 columns): rows a–e of one column are connected, and so are rows
 * f–j; the centre gap separates them. Four power rails run the length of the board: the top
 * pair (+ and −) and the bottom pair, each a single connection along its whole length.
 * Board pins are connection points of their own.
 *
 * Connection ids:
 *   bb:c12      breadboard hole, row c, column 12
 *   bb:top+5    top + rail, column 5   (also top-, bot+, bot-)
 *   pin:13      board pin 13; pin:A0, pin:5V, pin:GND
 *   pin:GNDx2   another pin of the same signal on a board with several (another GND, or A4 also
 *               brought out as SDA): the same pin electrically
 */
import { z } from 'zod';
import type { BoardDefinition } from '../types.js';
import { nodeOfPinField, type Circuit, type LedColour, type Part } from './circuit.js';
import { MALKON_ONE_PINS } from './malkon-one.js';
import { SMRS_PINS, type BenchPin } from './smrs.js';
import { BOARD_OUTLINES, MEGA_PINS, NANO_PINS, UNO_PINS } from './arduino-boards.js';

export const PITCH = 2.54; // mm between holes
/** Columns of a half-size breadboard (400 holes), the default. */
export const COLUMNS = 30;
/** Columns of a full-size breadboard (830 holes). Holes keep their place; the full size carries on to the right. */
export const FULL_COLUMNS = 63;
export type BreadboardSize = 'half' | 'full';
export const ROWS = 'abcdefghij';
export const RAILS = ['top+', 'top-', 'bot+', 'bot-'] as const;
export type Rail = (typeof RAILS)[number];

export const PLACEABLE = ['led', 'resistor', 'button', 'switch', 'potentiometer', 'buzzer', 'dc-motor', 'chassis'] as const;
export type PlaceableKind = (typeof PLACEABLE)[number];

const ConnId = z.string().regex(/^(bb:[a-j]([1-9]|[1-5]\d|6[0-3])|bb:(top|bot)[+-]([1-9]|[1-5]\d|6[0-3])|pin:[A-Za-z0-9]{1,6})$/);
export const PlacedPartSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind: z.enum(PLACEABLE),
  /** Row index of the first leg (0 = a … 9 = j). */
  row: z.number().int().min(0).max(9),
  /** Column of the first leg, 1…30. */
  col: z.number().int().min(1).max(FULL_COLUMNS),
  /**
   * Which way the legs go from the first leg: 0 along the row (higher columns), 90 down the column
   * (later rows), 180 back along the row, 270 up the column. The robot car: which way it faces.
   */
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  colour: z.enum(['red', 'yellow', 'green', 'blue', 'white']).optional(),
  ohms: z.number().positive().max(10_000_000).optional(),
  /** A motor whose wires go into the board's motor screw terminal A or B instead of the breadboard. */
  terminal: z.enum(['A', 'B']).optional(),
});
/** A point on the table, millimetres. */
const TablePoint = z.object({ x: z.number().min(-600).max(600), z: z.number().min(-600).max(600) });
export const WireSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  from: ConnId,
  to: ConnId,
  colour: z.string().regex(/^#[0-9a-f]{6}$/),
  /** Bends the learner pulled into the wire, in order from `from` to `to`. */
  via: z.array(TablePoint).max(16).optional(),
});
export const CircuitLayoutSchema = z.object({
  version: z.literal(1),
  /**
   * The bench starts empty: the learner puts the board and the breadboard on it. True when they did,
   * false when they put it away. Missing (projects from before): shown when something is plugged into it.
   */
  breadboard: z.boolean().optional(),
  board: z.boolean().optional(),
  /** Where the learner moved the board to (its centre, mm) and how far it is turned (quarter turns). Missing: its usual place. */
  boardAt: TablePoint.extend({ turn: z.number().int().min(0).max(3) }).optional(),
  /** Where the learner moved the breadboard to (offset, mm) and its turn (quarter turns). Missing: its usual place. */
  breadboardAt: TablePoint.extend({ turn: z.number().int().min(0).max(3).optional() }).optional(),
  /** Half size (400 holes, 30 columns; the default) or full size (830 holes, 63 columns). */
  breadboardSize: z.enum(['half', 'full']).optional(),
  parts: z.array(PlacedPartSchema).max(200),
  wires: z.array(WireSchema).max(400),
});
export type PlacedPart = z.infer<typeof PlacedPartSchema>;
export type Wire = z.infer<typeof WireSchema>;
export type CircuitLayout = z.infer<typeof CircuitLayoutSchema>;

export const emptyLayout = (): CircuitLayout => ({ version: 1, parts: [], wires: [] });

/** Each kind: its legs (name, offset in holes from the first leg), and a learner-facing name. */
export const PART_KINDS: Record<PlaceableKind, { name: string; legs: Array<{ name: string; offset: number }> }> = {
  led: { name: 'LED', legs: [{ name: 'long leg (+)', offset: 0 }, { name: 'short leg (−)', offset: 1 }] },
  resistor: { name: 'Resistor', legs: [{ name: 'end 1', offset: 0 }, { name: 'end 2', offset: 4 }] },
  button: { name: 'Push button', legs: [{ name: 'leg 1', offset: 0 }, { name: 'leg 2', offset: 2 }] },
  switch: { name: 'Slide switch', legs: [{ name: 'middle leg', offset: 0 }, { name: 'side leg', offset: 2 }] },
  potentiometer: { name: 'Potentiometer', legs: [{ name: 'end 1', offset: 0 }, { name: 'middle (wiper)', offset: 1 }, { name: 'end 2', offset: 2 }] },
  buzzer: { name: 'Buzzer', legs: [{ name: '+ leg', offset: 0 }, { name: '− leg', offset: 3 }] },
  // The motor stands in front of the breadboard; its two wires plug into neighbouring holes.
  'dc-motor': { name: 'DC motor', legs: [{ name: 'red wire (+)', offset: 0 }, { name: 'black wire (−)', offset: 1 }] },
  // The robot car: no legs of its own. It stands behind the breadboard and carries the board.
  chassis: { name: 'Robot car chassis', legs: [] },
};

export const WIRE_COLOURS = ['#e53935', '#212121', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#f5f5f5'] as const;

/** The holes a part's legs sit in, or undefined if a leg would fall off the breadboard. A motor on a screw terminal: the terminal's two connections. */
/** A part's turn, in degrees. */
export type PartTurn = 0 | 90 | 180 | 270;
/** The step from one leg to the next for each turn: [rows, columns]. */
const TURN_STEP: Record<PartTurn, readonly [number, number]> = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] };
/** The next quarter turn. */
export const nextTurn = (t: PartTurn): PartTurn => (((t + 90) % 360) as PartTurn);

/**
 * Where a part's first leg goes when it is turned to `rotation` about its own middle (so a part
 * turned end for end stays in the same holes, its legs swapped).
 */
export function turnAboutMiddle(p: Pick<PlacedPart, 'kind' | 'row' | 'col' | 'rotation'>, rotation: PartTurn): { row: number; col: number } {
  const legs = PART_KINDS[p.kind].legs;
  const span = legs.length ? Math.max(...legs.map((l) => l.offset)) : 0;
  const [r0, c0] = TURN_STEP[p.rotation];
  const [r1, c1] = TURN_STEP[rotation];
  const mid = { row: p.row + (r0 * span) / 2, col: p.col + (c0 * span) / 2 };
  // Odd spans have a half-hole middle: round the same way every time, so turning round comes back.
  return { row: Math.round(mid.row - (r1 * span) / 2 + 1e-9), col: Math.round(mid.col - (c1 * span) / 2 + 1e-9) };
}

/** Columns of the layout's breadboard. */
export const columnsOf = (layout: Pick<CircuitLayout, 'breadboardSize'>): number => (layout.breadboardSize === 'full' ? FULL_COLUMNS : COLUMNS);

/** The holes a part's legs sit in (within a full-size breadboard; `canPlace` and the analysis check the layout's own size). */
export function legHoles(p: Pick<PlacedPart, 'kind' | 'row' | 'col' | 'rotation'> & { terminal?: 'A' | 'B' | undefined }, cols = FULL_COLUMNS): string[] | undefined {
  if (p.kind === 'dc-motor' && p.terminal) return [`pin:M${p.terminal}1`, `pin:M${p.terminal}2`];
  const holes: string[] = [];
  for (const leg of PART_KINDS[p.kind].legs) {
    const [dr, dc] = TURN_STEP[p.rotation];
    const row = p.row + dr * leg.offset;
    const col = p.col + dc * leg.offset;
    if (row < 0 || row > 9 || col < 1 || col > cols) return undefined;
    holes.push(`bb:${ROWS[row]}${col}`);
  }
  return holes;
}

/** Which 3D model the workbench draws for a board: a real board's model, or a generic board. */
export function benchModel(board: BoardDefinition): 'smrs' | 'malkon-one' | 'uno' | 'nano' | 'mega' | 'generic' {
  switch (board.id) {
    case 'tariro':
      return 'smrs';
    case 'malkon-one':
      return 'malkon-one';
    case 'arduino-uno':
      return 'uno';
    case 'arduino-nano':
      return 'nano';
    case 'arduino-mega':
      return 'mega';
    default:
      // No real layout yet (the Malkon ESP32-S3's header positions are not confirmed): a generic board with its pins.
      return 'generic';
  }
}

/** The pins of a board drawn as its real model (bench orientation, mm from its centre). */
export function benchPins(board: BoardDefinition): readonly BenchPin[] | undefined {
  const model = benchModel(board);
  return { smrs: SMRS_PINS, 'malkon-one': MALKON_ONE_PINS, uno: UNO_PINS, nano: NANO_PINS, mega: MEGA_PINS, generic: undefined }[model];
}

/** A motor screw terminal of an onboard driver ('MA1' = A01 … 'MB2' = B02). */
export const isMotorTerminal = (pin: string): boolean => /^M[AB][12]$/.test(pin);
/** 'MA1' → 'Motor A terminal (A01)', as printed on the board. */
export const motorTerminalName = (pin: string): string => `Motor ${pin[1]} terminal (${pin[1]}0${pin[2]})`;
/** The motor terminals a board has on the workbench ('A', 'B'), if any. */
export const motorTerminals = (board: BoardDefinition): Array<'A' | 'B'> => (['A', 'B'] as const).filter((m) => benchConnectors(board).includes(`M${m}1`));

/** The simulator node of a board connection: '5V', 'GND', a terminal ('MA1') or a pin node ('D13'). */
function nodeOfBoardPin(board: BoardDefinition, pin: string): string | undefined {
  return pin === '5V' || pin === 'GND' || isMotorTerminal(pin) ? pin : nodeOfPinField(board, pin);
}

/** The pin a connection name is electrically: another GND pin ('GNDx2') is GND. */
export function canonicalPin(name: string): string {
  return name.replace(/x\d+$/, '');
}

/**
 * Board pins a learner can wire to, in order: digital pins, then the analog pins, then power.
 * On a board drawn as its real model these are the pins on its headers (the Malkon SMRS motor
 * driver uses D4–D7 on the board).
 */
export function boardPins(board: BoardDefinition): { digital: string[]; analog: string[]; power: string[] } {
  const real = benchPins(board);
  if (real) {
    const on = new Set(real.map((p) => p.pin));
    return {
      digital: board.pins.digital.map(String).filter((p) => on.has(p)),
      analog: board.pins.analog.filter((p) => on.has(p)),
      power: ['5V', 'GND'],
    };
  }
  return { digital: board.pins.digital.map(String), analog: [...board.pins.analog], power: ['5V', 'GND'] };
}

/** Every physical pin on the workbench, extra 5V and GND pins included ('GND2'…). */
export function benchConnectors(board: BoardDefinition): string[] {
  return benchPins(board)?.map((p) => p.id) ?? boardPinOrder(board);
}

// ───────────────────────── geometry (millimetres, y up, shared with the 3D view) ─────────────────────────

/** Breadboard hole centre on the table (x along the columns, z towards the learner). */
export function holePosition(id: string): { x: number; z: number } | undefined {
  const term = /^bb:([a-j])(\d+)$/.exec(id);
  const x = (col: number) => (col - (COLUMNS + 1) / 2) * PITCH;
  if (term) {
    const r = ROWS.indexOf(term[1]!);
    // Rows a–e above the centre gap (negative z), f–j below; the gap is 3 pitches wide.
    const z = r < 5 ? (r - 5) * PITCH - PITCH / 2 : (r - 4) * PITCH + PITCH / 2;
    return { x: x(Number(term[2])), z };
  }
  const rail = /^bb:(top|bot)([+-])(\d+)$/.exec(id);
  if (rail) {
    const top = rail[1] === 'top';
    // Outer rail is +, inner rail is −, as printed on most boards.
    const offset = rail[2] === '+' ? 9.5 : 8.5;
    return { x: x(Number(rail[3])), z: (top ? -1 : 1) * offset * PITCH };
  }
  return undefined;
}

/** Board pins sit in one header row along the edge of the board nearest the breadboard. */
export const BOARD_Z = -62;

/** Where the board is on the bench: its centre, how high it is lifted off the table, and its turn (quarter turns, anticlockwise from above). */
export interface BoardPlacement {
  x: number;
  z: number;
  lift: number;
  turn: number;
}
export const ON_TABLE: BoardPlacement = { x: 0, z: BOARD_Z, lift: 0, turn: 0 };
/**
 * The robot car chassis (millimetres): it stands behind the breadboard, its front away from the
 * learner, and its deck is this high off the table. The board sits on the deck, a little forward
 * of the centre; the left motor is Motor A and the right one Motor B, as on the Tariro robot.
 */
export const CHASSIS = { z: -105, deckHeight: 48.2, boardZ: -115 } as const;
export const ON_CHASSIS: BoardPlacement = { x: 0, z: CHASSIS.boardZ, lift: CHASSIS.deckHeight, turn: 0 };
/** Where the board is for this layout: on the table, or on the robot car's deck. */
export function boardPlacement(layout: CircuitLayout): BoardPlacement {
  if (layout.parts.some((p) => p.kind === 'chassis')) return ON_CHASSIS;
  const at = layout.boardAt;
  return at ? { x: at.x, z: at.z, lift: 0, turn: at.turn } : ON_TABLE;
}

/** A point given relative to the board's centre, turned and moved to where the board is (the same turn the 3D view applies). */
export function placeOnBoard(place: BoardPlacement, lx: number, lz: number): { x: number; z: number } {
  const a = (place.turn * Math.PI) / 2;
  const [c, s] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
  return { x: place.x + lx * c + lz * s, z: place.z - lx * s + lz * c };
}

/**
 * Where a board connection is on the bench (for the board where `place` puts it); `y`, when given,
 * is its height above the PCB's top (a screw terminal's wire entry).
 */
export function pinPosition(board: BoardDefinition, id: string, place: BoardPlacement = ON_TABLE): { x: number; z: number; y?: number } | undefined {
  const m = /^pin:(.+)$/.exec(id);
  if (!m) return undefined;
  const real = benchPins(board);
  if (real) {
    const p = real.find((q) => q.id === m[1]);
    return p ? { ...placeOnBoard(place, p.x, p.z), ...(p.y !== undefined ? { y: p.y } : {}) } : undefined;
  }
  const all = boardPinOrder(board);
  const i = all.indexOf(m[1]!);
  if (i < 0) return undefined;
  const gapBefore = i >= boardPins(board).digital.length ? 1 : 0;
  const gapPower = i >= boardPins(board).digital.length + boardPins(board).analog.length ? 1 : 0;
  return placeOnBoard(place, (i + (gapBefore + gapPower) * 1.5 - (all.length + 3) / 2) * PITCH, 16);
}
export function boardPinOrder(board: BoardDefinition): string[] {
  const p = boardPins(board);
  return [...p.digital, ...p.analog, ...p.power];
}
/** Where the breadboard is: moved by (x, z), turned (quarter turns about its own centre), and how many columns it has. */
export interface BreadboardPlacement {
  x: number;
  z: number;
  turn: number;
  cols: number;
}
export const BREADBOARD_HOME: BreadboardPlacement = { x: 0, z: 0, turn: 0, cols: COLUMNS };
export function breadboardPlacement(layout: CircuitLayout): BreadboardPlacement {
  const at = layout.breadboardAt;
  return { x: at?.x ?? 0, z: at?.z ?? 0, turn: at?.turn ?? 0, cols: columnsOf(layout) };
}
/** The breadboard's own centre in hole coordinates (a full-size board reaches further right). */
export const breadboardCentreX = (cols: number): number => ((cols - COLUMNS) / 2) * PITCH;

/** A point in hole coordinates (as `holePosition` gives) to the table, where the breadboard is now. */
export function placeOnBreadboard(bb: Pick<BreadboardPlacement, 'x' | 'z' | 'turn' | 'cols'>, x: number, z: number): { x: number; z: number } {
  const cx = breadboardCentreX(bb.cols);
  const a = (bb.turn * Math.PI) / 2;
  const [c, s] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
  const [lx, lz] = [x - cx, z];
  return { x: bb.x + cx + lx * c + lz * s, z: bb.z - lx * s + lz * c };
}
/** The reverse: a point on the table to hole coordinates. */
export function fromBreadboard(bb: Pick<BreadboardPlacement, 'x' | 'z' | 'turn' | 'cols'>, x: number, z: number): { x: number; z: number } {
  const cx = breadboardCentreX(bb.cols);
  const a = (bb.turn * Math.PI) / 2;
  const [c, s] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
  const [dx, dz] = [x - bb.x - cx, z - bb.z];
  return { x: cx + dx * c - dz * s, z: dx * s + dz * c };
}

export function connectionPosition(board: BoardDefinition, id: string, place: BoardPlacement = ON_TABLE, bb: Partial<BreadboardPlacement> & { x: number; z: number } = BREADBOARD_HOME): { x: number; z: number; y?: number } | undefined {
  if (id.startsWith('pin:')) return pinPosition(board, id, place);
  const h = holePosition(id);
  return h && placeOnBreadboard({ turn: 0, cols: COLUMNS, ...bb }, h.x, h.z);
}

/** Is anything plugged into the breadboard (a part's legs or a wire end)? Then it cannot be put away. */
export function breadboardInUse(layout: CircuitLayout): boolean {
  return layout.parts.some((p) => (legHoles(p) ?? []).some((h) => h.startsWith('bb:'))) || layout.wires.some((w) => w.from.startsWith('bb:') || w.to.startsWith('bb:'));
}

/** Is anything connected to the board (a wire to a pin, a motor on its terminals)? Then it cannot be taken off. */
export function boardInUse(layout: CircuitLayout): boolean {
  return layout.parts.some((p) => !!p.terminal) || layout.wires.some((w) => w.from.startsWith('pin:') || w.to.startsWith('pin:'));
}
/** Is the breadboard on the bench? */
export const showsBreadboard = (layout: CircuitLayout): boolean => layout.breadboard ?? breadboardInUse(layout);
/** Is the board on the bench? */
export const showsBoard = (layout: CircuitLayout): boolean => layout.board ?? boardInUse(layout);

/** Every breadboard connection id (terminal holes and rails). */
export function allHoles(cols = COLUMNS): string[] {
  const out: string[] = [];
  for (let c = 1; c <= cols; c++) {
    for (const r of ROWS) out.push(`bb:${r}${c}`);
    for (const rail of RAILS) out.push(`bb:${rail}${c}`);
  }
  return out;
}

// ───────────────────────── electrical connectivity ─────────────────────────

/** The breadboard strip a hole belongs to: a column half or a whole rail. */
function stripOf(id: string): string {
  const term = /^bb:([a-j])(\d+)$/.exec(id);
  if (term) return `strip:${ROWS.indexOf(term[1]!) < 5 ? 'top' : 'bot'}:${term[2]}`;
  const rail = /^bb:((top|bot)[+-])\d+$/.exec(id);
  if (rail) return `rail:${rail[1]}`;
  return id; // a board pin is its own point
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface LayoutProblem {
  /** The part or wire concerned, if any. */
  id?: string;
  message: string;
  /** Errors stop the simulation; warnings do not. */
  severity: 'error' | 'warning';
}

export interface LayoutAnalysis {
  circuit: Circuit;
  /** Simulator node of every connection point in use. */
  nodeOf: Map<string, string>;
  /** Node of any connection point, used or not (a hole is joined to its strip). Undefined if nothing is connected there. */
  nodeAt(id: string): string | undefined;
  /** How many legs and wire ends share this node (1 = the leg alone in its strip). */
  linksOn(node: string): number;
  problems: LayoutProblem[];
}

const partLabel = (p: PlacedPart, n: number) =>
  p.kind === 'led' ? `${(p.colour ?? 'red').replace(/^./, (c) => c.toUpperCase())} LED ${n}` : p.kind === 'resistor' ? `${formatOhms(p.ohms ?? 220)} resistor ${n}` : `${PART_KINDS[p.kind].name} ${n}`;

export function formatOhms(ohms: number): string {
  return ohms >= 1e6 ? `${+(ohms / 1e6).toFixed(2)} MΩ` : ohms >= 1e3 ? `${+(ohms / 1e3).toFixed(2)} kΩ` : `${+ohms.toFixed(1)} Ω`;
}

/**
 * Turn a layout into a circuit: which holes are joined (strips, rails, wires), which board pin
 * each group reaches, and so which simulator node each leg is on.
 */
export function analyseLayout(layout: CircuitLayout, board: BoardDefinition): LayoutAnalysis {
  const uf = new UnionFind();
  const problems: LayoutProblem[] = [];
  const used = new Set<string>();
  const placed: Array<{ part: PlacedPart; holes: string[] }> = [];
  const holeOwner = new Map<string, string>();

  const cols = columnsOf(layout);
  for (const part of layout.parts) {
    const holes = legHoles(part, cols);
    if (!holes) {
      problems.push({ id: part.id, message: `${PART_KINDS[part.kind].name} hangs off the edge of the breadboard.`, severity: 'error' });
      continue;
    }
    for (const h of holes) {
      const other = holeOwner.get(h);
      if (other)
        problems.push({
          id: part.id,
          message: h.startsWith('pin:') ? `Two motors are on the same motor terminal (${h.slice(5, 6)}).` : `Two parts are pushed into the same hole (${h.slice(3)}).`,
          severity: 'error',
        });
      holeOwner.set(h, part.id);
      used.add(h);
      uf.union(h, stripOf(h));
    }
    placed.push({ part, holes });
  }
  if (layout.parts.filter((p) => p.kind === 'chassis').length > 1) problems.push({ message: 'There are two robot car chassis on the bench; one is enough.', severity: 'error' });
  const validPins = new Set(benchConnectors(board).map((p) => `pin:${p}`));
  for (const w of layout.wires) {
    for (const end of [w.from, w.to]) {
      if (end.startsWith('pin:') && !validPins.has(end)) problems.push({ id: w.id, message: `${board.name} has no pin ${end.slice(4)}.`, severity: 'error' });
      used.add(end);
      uf.union(end, stripOf(end));
    }
    uf.union(w.from, w.to);
  }

  // Name each group after the board pin it reaches. Two different pins in one group is a short.
  const groupNode = new Map<string, string>();
  const groupPins = new Map<string, string[]>();
  for (const id of used) if (id.startsWith('pin:')) groupPins.set(uf.find(id), [...(groupPins.get(uf.find(id)) ?? []), canonicalPin(id.slice(4))]);
  for (const [root, pins] of groupPins) {
    const unique = [...new Set(pins)];
    const nodes = unique.map((p) => nodeOfBoardPin(board, p)!);
    if (nodes.includes('5V') && nodes.includes('GND')) problems.push({ message: 'Short circuit: 5V is wired straight to GND. Remove that wire before running.', severity: 'error' });
    else if (unique.length > 1)
      problems.push({ message: `Pins ${unique.join(' and ')} are wired together. If the program drives them differently, the pins fight each other.`, severity: 'warning' });
    groupNode.set(root, nodes.includes('GND') ? 'GND' : nodes.includes('5V') ? '5V' : nodes[0]!);
  }
  const nodeOf = new Map<string, string>();
  for (const id of used) {
    const root = uf.find(id);
    nodeOf.set(id, groupNode.get(root) ?? `net:${root}`);
  }

  const counts: Record<string, number> = {};
  const parts: Part[] = [];
  for (const { part, holes } of placed) {
    counts[part.kind] = (counts[part.kind] ?? 0) + 1;
    const label = partLabel(part, counts[part.kind]!);
    const n = holes.map((h) => nodeOf.get(h)!);
    if (n.length >= 2 && new Set(n).size === 1)
      problems.push({ id: part.id, message: `${label}: all its legs are in one connected strip, so it is shorted out. Turn it to cross different columns.`, severity: 'warning' });
    switch (part.kind) {
      case 'led':
        parts.push({ kind: 'led', id: part.id, label, anode: n[0]!, cathode: n[1]!, colour: (part.colour ?? 'red') as LedColour });
        break;
      case 'resistor':
        parts.push({ kind: 'resistor', id: part.id, label, a: n[0]!, b: n[1]!, ohms: part.ohms ?? 220 });
        break;
      case 'button':
        parts.push({ kind: 'button', id: part.id, label, a: n[0]!, b: n[1]! });
        break;
      case 'switch':
        parts.push({ kind: 'switch', id: part.id, label, a: n[0]!, b: n[1]! });
        break;
      case 'potentiometer':
        parts.push({ kind: 'potentiometer', id: part.id, label, high: n[2]!, wiper: n[1]!, low: n[0]!, ohms: part.ohms ?? 10_000 });
        break;
      case 'buzzer':
        parts.push({ kind: 'buzzer', id: part.id, label, pos: n[0]!, neg: n[1]! });
        break;
      case 'dc-motor':
        parts.push({ kind: 'dc-motor', id: part.id, label, pos: n[0]!, neg: n[1]! });
        break;
    }
  }
  // The board's motor driver, for each motor terminal in use: direction and speed come from its pins.
  const driver = board.onboard?.find((o) => o.kind === 'dual-motor-driver')?.pins;
  if (driver)
    for (const m of ['A', 'B'] as const) {
      if (![...used].some((u) => u === `pin:M${m}1` || u === `pin:M${m}2`) || driver[`IN${m}`] === undefined || driver[`EN${m}`] === undefined) continue;
      parts.push({
        kind: 'h-bridge',
        id: `driver-${m.toLowerCase()}`,
        label: `Motor driver ${m} (pins ${driver[`IN${m}`]} and ${driver[`EN${m}`]})`,
        direction: `D${driver[`IN${m}`]}`,
        speed: `D${driver[`EN${m}`]}`,
        out1: nodeOf.get(`pin:M${m}1`) ?? `M${m}1`,
        out2: nodeOf.get(`pin:M${m}2`) ?? `M${m}2`,
      });
    }
  const nodeAt = (id: string): string | undefined => {
    if (nodeOf.has(id)) return nodeOf.get(id);
    if (id.startsWith('pin:')) {
      // A board pin is its own node even with nothing plugged in.
      return nodeOfBoardPin(board, canonicalPin(id.slice(4)));
    }
    const root = uf.find(stripOf(id));
    return groupNode.get(root) ?? ([...used].some((u) => uf.find(u) === root) ? `net:${root}` : undefined);
  };
  const links = new Map<string, number>();
  for (const node of nodeOf.values()) links.set(node, (links.get(node) ?? 0) + 1);
  return { circuit: { parts }, nodeOf, nodeAt, linksOn: (node) => links.get(node) ?? 0, problems };
}

// ───────────────────────── editing helpers ─────────────────────────

export function occupiedHoles(layout: CircuitLayout, except?: string): Set<string> {
  const out = new Set<string>();
  for (const p of layout.parts) if (p.id !== except) for (const h of legHoles(p) ?? []) out.add(h);
  return out;
}

/** Can a part go here without hanging off the board or sharing a hole? */
export function canPlace(layout: CircuitLayout, p: Pick<PlacedPart, 'kind' | 'row' | 'col' | 'rotation'>, except?: string): boolean {
  const holes = legHoles(p, columnsOf(layout));
  if (!holes) return false;
  const busy = occupiedHoles(layout, except);
  return holes.every((h) => !busy.has(h));
}

/** The first free place for a new part, scanning row a, then e, f, j, then the rest, left to right. */
export function firstFreeSpot(layout: CircuitLayout, kind: PlaceableKind): Pick<PlacedPart, 'row' | 'col' | 'rotation'> | undefined {
  for (const row of [0, 4, 5, 9, 1, 2, 3, 6, 7, 8])
    for (let col = 1; col <= columnsOf(layout); col++) {
      const spot = { row, col, rotation: 0 as const };
      // Never share a column strip with a part already there: that would join them by accident.
      if (canPlace(layout, { kind, ...spot }) && !occupiedStripsTouch(layout, kind, spot)) return spot;
    }
  return undefined;
}

/** True if a part at `spot` would share a column strip with a part already there. */
function occupiedStripsTouch(layout: CircuitLayout, kind: PlaceableKind, spot: Pick<PlacedPart, 'row' | 'col' | 'rotation'>): boolean {
  const mine = new Set((legHoles({ kind, ...spot }) ?? []).map(stripOf));
  for (const h of occupiedHoles(layout)) if (mine.has(stripOf(h))) return true;
  return false;
}

/** A free hole in the same connected strip as `hole` (to plug a wire end into). */
export function freeHoleInStrip(layout: CircuitLayout, hole: string): string | undefined {
  const busy = occupiedHoles(layout);
  for (const w of layout.wires) busy.add(w.from).add(w.to);
  const strip = stripOf(hole);
  return allHoles(columnsOf(layout)).find((h) => stripOf(h) === strip && !busy.has(h));
}

/** The nearest breadboard connection to a point on the table, within `maxMm`. */
export function nearestHole(x: number, z: number, maxMm = PITCH * 0.75, cols = COLUMNS): string | undefined {
  let best: string | undefined;
  let bestD = maxMm;
  for (const id of allHoles(cols)) {
    const p = holePosition(id)!;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** Terminal hole → [row index, column]. */
export function parseHole(id: string): { row: number; col: number } | undefined {
  const m = /^bb:([a-j])(\d+)$/.exec(id);
  return m ? { row: ROWS.indexOf(m[1]!), col: Number(m[2]) } : undefined;
}

// ───────────────────────── from blocks to a breadboard ─────────────────────────

export interface BuiltLayout {
  layout: CircuitLayout;
  /** Parts the workbench cannot hold yet (modules, motors). */
  skipped: string[];
}

/**
 * Lay out a circuit worked out from the blocks (see `deriveCircuit`) on the breadboard, with
 * the wires to the board, so a learner can move from the auto circuit to building it by hand.
 */
export function layoutFromCircuit(circuit: Circuit, board: BoardDefinition): BuiltLayout {
  const layout = emptyLayout();
  const skipped: string[] = [];
  let col = 1;
  let n = 0;
  const id = (k: string) => `${k}-${++n}`;
  const pinOf = (node: string) => {
    if (node === '5V' || node === 'GND') return node;
    const d = Number(node.slice(1));
    const base = Math.max(...board.pins.digital) + 1;
    return d >= base ? `A${d - base}` : String(d);
  };
  const wire = (from: string, to: string, colour: string) => layout.wires.push({ id: id('w'), from, to, colour });
  let gndRail = false;
  let vccRail = false;
  const toGnd = (hole: string) => {
    if (!gndRail) {
      wire('pin:GND', 'bb:top-30', WIRE_COLOURS[1]);
      gndRail = true;
    }
    wire(hole, `bb:top-${parseHole(hole)!.col}`, WIRE_COLOURS[1]);
  };
  const toVcc = (hole: string) => {
    if (!vccRail) {
      wire('pin:5V', 'bb:top+29', WIRE_COLOURS[0]);
      vccRail = true;
    }
    wire(hole, `bb:top+${parseHole(hole)!.col}`, WIRE_COLOURS[0]);
  };
  const fits = (width: number) => col + width - 1 <= COLUMNS;
  const onBoard = new Set(boardPinOrder(board));
  /** A part on a pin this board has no header pin for cannot be wired on the bench. */
  const offBoard = (...nodes: string[]) => nodes.some((nd) => !onBoard.has(pinOf(nd)));
  // The resistor that belongs to an LED is placed with it.
  const resistorFor = new Map(circuit.parts.filter((p): p is Extract<Part, { kind: 'resistor' }> => p.kind === 'resistor').map((r) => [r.b, r]));

  for (const p of circuit.parts) {
    if (p.kind === 'resistor') continue;
    if (p.kind === 'led') {
      const r = resistorFor.get(p.anode);
      if (!fits(7) || offBoard(r?.a ?? p.anode)) {
        skipped.push(p.label);
        continue;
      }
      // pin → a{c}; resistor from b{c} to b{c+4}; the LED's long leg in the resistor's far strip.
      wire(`pin:${pinOf(r?.a ?? p.anode)}`, `bb:a${col}`, WIRE_COLOURS[(n % 4) + 2]!);
      if (r) layout.parts.push({ id: id('resistor'), kind: 'resistor', row: 1, col, rotation: 0, ohms: r.ohms });
      const ledCol = r ? col + 4 : col;
      layout.parts.push({ id: id('led'), kind: 'led', row: 2, col: ledCol, rotation: 0, colour: p.colour });
      toGnd(`bb:d${ledCol + 1}`);
      col = ledCol + 3;
    } else if (p.kind === 'button' || p.kind === 'switch') {
      const signal = p.a === '5V' || p.a === 'GND' ? p.b : p.a;
      if (!fits(4) || offBoard(signal)) {
        skipped.push(p.label);
        continue;
      }
      layout.parts.push({ id: id(p.kind), kind: p.kind, row: 2, col, rotation: 0 });
      const other = signal === p.a ? p.b : p.a;
      wire(`pin:${pinOf(signal)}`, `bb:a${col}`, WIRE_COLOURS[2]!);
      if (other === 'GND') toGnd(`bb:d${col + 2}`);
      else toVcc(`bb:d${col + 2}`);
      col += 4;
    } else if (p.kind === 'potentiometer') {
      if (!fits(4) || offBoard(p.wiper)) {
        skipped.push(p.label);
        continue;
      }
      layout.parts.push({ id: id('potentiometer'), kind: 'potentiometer', row: 2, col, rotation: 0, ohms: p.ohms });
      toGnd(`bb:d${col}`);
      wire(`pin:${pinOf(p.wiper)}`, `bb:a${col + 1}`, WIRE_COLOURS[4]!);
      toVcc(`bb:d${col + 2}`);
      col += 4;
    } else if (p.kind === 'buzzer') {
      if (!fits(5) || offBoard(p.pos)) {
        skipped.push(p.label);
        continue;
      }
      layout.parts.push({ id: id('buzzer'), kind: 'buzzer', row: 2, col, rotation: 0 });
      wire(`pin:${pinOf(p.pos)}`, `bb:a${col}`, WIRE_COLOURS[5]!);
      toGnd(`bb:d${col + 3}`);
      col += 5;
    } else if (p.kind === 'motor' && /^motor:[AB]$/.test(p.id) && benchConnectors(board).includes(`M${p.id.slice(6)}1`)) {
      // A motor the board's own driver runs (Motor A or B): straight into that screw terminal.
      layout.parts.push({ id: id('dc-motor'), kind: 'dc-motor', row: 0, col: 1, rotation: 0, terminal: p.id.slice(6) as 'A' | 'B' });
    } else skipped.push(p.label);
  }
  // Building from the blocks puts the board on the bench, and the breadboard when a part needs it.
  layout.board = true;
  if (breadboardInUse(layout)) layout.breadboard = true;
  return { layout, skipped };
}

// ───────────────────────── keeping the board off the breadboard ─────────────────────────

/** A rectangle on the table: centre and size (mm). */
interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** The board's outline on the table, from its own model (centre relative to the board's centre, then placed). */
export function boardFootprint(board: BoardDefinition, place: BoardPlacement): Rect {
  const model = benchModel(board);
  let local: Rect;
  if (model === 'smrs') local = { x: -1.4, z: 0.4, w: 106, d: 70.6 };
  else if (model === 'uno' || model === 'nano' || model === 'mega') {
    const o = BOARD_OUTLINES[model];
    local = { x: 0, z: 0, w: o.width, d: o.depth };
  } else {
    // From where its pins are, with the PCB round them.
    const pins = (benchPins(board) ?? []).map((p) => ({ x: p.x, z: p.z }));
    const all = pins.length ? pins : boardPinOrder(board).map((p) => pinPosition(board, `pin:${p}`, { x: 0, z: 0, lift: 0, turn: 0 })!);
    const xs = all.map((p) => p.x);
    const zs = all.map((p) => p.z);
    const w = Math.max(68.6, Math.max(...xs) - Math.min(...xs) + 16);
    const d = Math.max(53.3, Math.max(...zs) - Math.min(...zs) + 16);
    local = { x: (Math.max(...xs) + Math.min(...xs)) / 2, z: pins.length ? (Math.max(...zs) + Math.min(...zs)) / 2 : 0, w, d };
  }
  const c = placeOnBoard(place, local.x, local.z);
  return place.turn % 2 ? { x: c.x, z: c.z, w: local.d, d: local.w } : { x: c.x, z: c.z, w: local.w, d: local.d };
}

/** The breadboard's outline on the table. */
export function breadboardFootprint(bb: BreadboardPlacement): Rect {
  const [w, d] = [bb.cols * PITCH + 8, 55];
  const c = placeOnBreadboard(bb, breadboardCentreX(bb.cols), 0);
  return bb.turn % 2 ? { x: c.x, z: c.z, w: d, d: w } : { x: c.x, z: c.z, w, d };
}

const overlaps = (a: Rect, b: Rect, gap = 0) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + gap;

/** Do the board and the breadboard, both on the bench, overlap? (On the robot car the board is lifted above it.) */
export function benchOverlap(layout: CircuitLayout, board: BoardDefinition): boolean {
  if (!showsBoard(layout) || !showsBreadboard(layout) || layout.parts.some((p) => p.kind === 'chassis')) return false;
  // Edges touching is fine (the outlines are a millimetre or two generous): only a real overlap counts.
  return overlaps(boardFootprint(board, boardPlacement(layout)), breadboardFootprint(breadboardPlacement(layout)), -2);
}

/**
 * The same layout with the board moved the shortest way off the breadboard, if they overlap (a turn,
 * a bigger breadboard or another board can make them); unchanged (the same object) otherwise.
 */
export function separateBoard(layout: CircuitLayout, board: BoardDefinition): CircuitLayout {
  if (!benchOverlap(layout, board)) return layout;
  const place = boardPlacement(layout);
  const a = boardFootprint(board, place);
  const b = breadboardFootprint(breadboardPlacement(layout));
  const gap = 4;
  const sx = (b.w + a.w) / 2 + gap;
  const sz = (b.d + a.d) / 2 + gap;
  // Behind the breadboard first (where the board usually is), then in front, left and right.
  const moves = [
    { dx: 0, dz: b.z - sz - a.z },
    { dx: 0, dz: b.z + sz - a.z },
    { dx: b.x - sx - a.x, dz: 0 },
    { dx: b.x + sx - a.x, dz: 0 },
  ];
  const best = moves.reduce((m, n) => (Math.hypot(n.dx, n.dz) < Math.hypot(m.dx, m.dz) - 0.01 ? n : m));
  const round = (v: number) => Math.round(v * 2) / 2;
  return { ...layout, boardAt: { x: round(place.x + best.dx), z: round(place.z + best.dz), turn: place.turn } };
}
