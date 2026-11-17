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
 */
import { z } from 'zod';
import type { BoardDefinition } from '../types.js';
import { nodeOfPinField, type Circuit, type LedColour, type Part } from './circuit.js';

export const PITCH = 2.54; // mm between holes
export const COLUMNS = 30;
export const ROWS = 'abcdefghij';
export const RAILS = ['top+', 'top-', 'bot+', 'bot-'] as const;
export type Rail = (typeof RAILS)[number];

export const PLACEABLE = ['led', 'resistor', 'button', 'switch', 'potentiometer', 'buzzer'] as const;
export type PlaceableKind = (typeof PLACEABLE)[number];

const ConnId = z.string().regex(/^(bb:[a-j]([1-9]|[12]\d|30)|bb:(top|bot)[+-]([1-9]|[12]\d|30)|pin:[A-Za-z0-9]{1,4})$/);
export const PlacedPartSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind: z.enum(PLACEABLE),
  /** Row index of the first leg (0 = a … 9 = j). */
  row: z.number().int().min(0).max(9),
  /** Column of the first leg, 1…30. */
  col: z.number().int().min(1).max(COLUMNS),
  /** 0: legs go along the row (to higher columns); 90: legs go down the column (to later rows). */
  rotation: z.union([z.literal(0), z.literal(90)]),
  colour: z.enum(['red', 'yellow', 'green', 'blue', 'white']).optional(),
  ohms: z.number().positive().max(10_000_000).optional(),
});
export const WireSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  from: ConnId,
  to: ConnId,
  colour: z.string().regex(/^#[0-9a-f]{6}$/),
});
export const CircuitLayoutSchema = z.object({
  version: z.literal(1),
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
};

export const WIRE_COLOURS = ['#e53935', '#212121', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#f5f5f5'] as const;

/** The holes a part's legs sit in, or undefined if a leg would fall off the breadboard. */
export function legHoles(p: Pick<PlacedPart, 'kind' | 'row' | 'col' | 'rotation'>): string[] | undefined {
  const holes: string[] = [];
  for (const leg of PART_KINDS[p.kind].legs) {
    const row = p.rotation === 90 ? p.row + leg.offset : p.row;
    const col = p.rotation === 90 ? p.col : p.col + leg.offset;
    if (row > 9 || col > COLUMNS) return undefined;
    holes.push(`bb:${ROWS[row]}${col}`);
  }
  return holes;
}

/** Board pins shown on the workbench header, in order: digital pins, then the analog pins, then power. */
export function boardPins(board: BoardDefinition): { digital: string[]; analog: string[]; power: string[] } {
  return { digital: board.pins.digital.map(String), analog: [...board.pins.analog], power: ['5V', 'GND'] };
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
export function pinPosition(board: BoardDefinition, id: string): { x: number; z: number } | undefined {
  const m = /^pin:(.+)$/.exec(id);
  if (!m) return undefined;
  const all = boardPinOrder(board);
  const i = all.indexOf(m[1]!);
  if (i < 0) return undefined;
  const gapBefore = i >= boardPins(board).digital.length ? 1 : 0;
  const gapPower = i >= boardPins(board).digital.length + boardPins(board).analog.length ? 1 : 0;
  return { x: (i + (gapBefore + gapPower) * 1.5 - (all.length + 3) / 2) * PITCH, z: BOARD_Z + 16 };
}
export function boardPinOrder(board: BoardDefinition): string[] {
  const p = boardPins(board);
  return [...p.digital, ...p.analog, ...p.power];
}
export function connectionPosition(board: BoardDefinition, id: string): { x: number; z: number } | undefined {
  return id.startsWith('pin:') ? pinPosition(board, id) : holePosition(id);
}

/** Every breadboard connection id (terminal holes and rails). */
export function allHoles(): string[] {
  const out: string[] = [];
  for (let c = 1; c <= COLUMNS; c++) {
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

  for (const part of layout.parts) {
    const holes = legHoles(part);
    if (!holes) {
      problems.push({ id: part.id, message: `${PART_KINDS[part.kind].name} hangs off the edge of the breadboard.`, severity: 'error' });
      continue;
    }
    for (const h of holes) {
      const other = holeOwner.get(h);
      if (other) problems.push({ id: part.id, message: `Two parts are pushed into the same hole (${h.slice(3)}).`, severity: 'error' });
      holeOwner.set(h, part.id);
      used.add(h);
      uf.union(h, stripOf(h));
    }
    placed.push({ part, holes });
  }
  const validPins = new Set(boardPinOrder(board).map((p) => `pin:${p}`));
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
  for (const id of used) if (id.startsWith('pin:')) groupPins.set(uf.find(id), [...(groupPins.get(uf.find(id)) ?? []), id.slice(4)]);
  for (const [root, pins] of groupPins) {
    const unique = [...new Set(pins.map((p) => (p === 'GND' ? 'GND' : p)))];
    const nodes = unique.map((p) => (p === '5V' ? '5V' : p === 'GND' ? 'GND' : nodeOfPinField(board, p)!));
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
    }
  }
  const nodeAt = (id: string): string | undefined => {
    if (nodeOf.has(id)) return nodeOf.get(id);
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
  const holes = legHoles(p);
  if (!holes) return false;
  const busy = occupiedHoles(layout, except);
  return holes.every((h) => !busy.has(h));
}

/** The first free place for a new part, scanning row a, then e, f, j, then the rest, left to right. */
export function firstFreeSpot(layout: CircuitLayout, kind: PlaceableKind): Pick<PlacedPart, 'row' | 'col' | 'rotation'> | undefined {
  for (const row of [0, 4, 5, 9, 1, 2, 3, 6, 7, 8])
    for (let col = 1; col <= COLUMNS; col++) {
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
  return allHoles().find((h) => stripOf(h) === strip && !busy.has(h));
}

/** The nearest breadboard connection to a point on the table, within `maxMm`. */
export function nearestHole(x: number, z: number, maxMm = PITCH * 0.75): string | undefined {
  let best: string | undefined;
  let bestD = maxMm;
  for (const id of allHoles()) {
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
  // The resistor that belongs to an LED is placed with it.
  const resistorFor = new Map(circuit.parts.filter((p): p is Extract<Part, { kind: 'resistor' }> => p.kind === 'resistor').map((r) => [r.b, r]));

  for (const p of circuit.parts) {
    if (p.kind === 'resistor') continue;
    if (p.kind === 'led') {
      const r = resistorFor.get(p.anode);
      if (!fits(7)) {
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
      if (!fits(4)) {
        skipped.push(p.label);
        continue;
      }
      layout.parts.push({ id: id(p.kind), kind: p.kind, row: 2, col, rotation: 0 });
      const signal = p.a === '5V' || p.a === 'GND' ? p.b : p.a;
      const other = signal === p.a ? p.b : p.a;
      wire(`pin:${pinOf(signal)}`, `bb:a${col}`, WIRE_COLOURS[2]!);
      if (other === 'GND') toGnd(`bb:d${col + 2}`);
      else toVcc(`bb:d${col + 2}`);
      col += 4;
    } else if (p.kind === 'potentiometer') {
      if (!fits(4)) {
        skipped.push(p.label);
        continue;
      }
      layout.parts.push({ id: id('potentiometer'), kind: 'potentiometer', row: 2, col, rotation: 0, ohms: p.ohms });
      toGnd(`bb:d${col}`);
      wire(`pin:${pinOf(p.wiper)}`, `bb:a${col + 1}`, WIRE_COLOURS[4]!);
      toVcc(`bb:d${col + 2}`);
      col += 4;
    } else if (p.kind === 'buzzer') {
      if (!fits(5)) {
        skipped.push(p.label);
        continue;
      }
      layout.parts.push({ id: id('buzzer'), kind: 'buzzer', row: 2, col, rotation: 0 });
      wire(`pin:${pinOf(p.pos)}`, `bb:a${col}`, WIRE_COLOURS[5]!);
      toGnd(`bb:d${col + 3}`);
      col += 5;
    } else skipped.push(p.label);
  }
  return { layout, skipped };
}
