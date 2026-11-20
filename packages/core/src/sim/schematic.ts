/**
 * The schematic (Phase 8b): the same circuit the breadboard shows, laid out as a circuit diagram.
 *
 * Most learner circuits are chains: a board pin, a few parts one after the other, then GND or 5V.
 * Each such chain becomes one row, read left to right in the direction from the pin (so an LED drawn
 * pointing back towards the pin is visibly the wrong way round). Whatever is not a simple chain (a
 * potentiometer, a part between two inner points, the board's own motor driver) is listed with a
 * label on each leg naming the point it joins, as real schematics do with net labels.
 */
import type { BoardDefinition } from '../types.js';
import { pinLabel, SUPPLY, type Part } from './circuit.js';
import { isMotorTerminal } from './layout.js';
import { GROUND } from './solver.js';

/** One end of a row, or the point a leg joins. */
export interface NetEnd {
  kind: 'pin' | 'gnd' | '5v' | 'net' | 'motor';
  /** What is printed: "pin 13", "GND", "5V", "point 1", "motor A (A01)". */
  label: string;
  node: string;
}

export interface ChainItem {
  partId: string;
  kind: Part['kind'];
  label: string;
  /** For parts with a direction (LED, buzzer, motor): true when it is drawn against the direction from the pin. */
  reversed: boolean;
}

export interface SchematicRow {
  from: NetEnd;
  items: ChainItem[];
  to: NetEnd;
}

export interface SchematicOther {
  partId: string;
  kind: Part['kind'];
  label: string;
  legs: Array<{ leg: string; to: NetEnd }>;
}

export interface Schematic {
  rows: SchematicRow[];
  others: SchematicOther[];
}

/** Two-legged parts, and which leg is "first" (the + side for parts that have one). */
function twoLegs(p: Part): [string, string] | undefined {
  switch (p.kind) {
    case 'resistor':
    case 'button':
    case 'switch':
      return [p.a, p.b];
    case 'led':
      return [p.anode, p.cathode];
    case 'buzzer':
    case 'dc-motor':
      return [p.pos, p.neg];
    default:
      return undefined;
  }
}

const POLARISED = new Set<Part['kind']>(['led', 'buzzer', 'dc-motor']);

function legsOf(p: Part): Array<[string, string]> {
  switch (p.kind) {
    case 'potentiometer':
      return [
        ['end 1', p.low],
        ['wiper', p.wiper],
        ['end 2', p.high],
      ];
    case 'h-bridge':
      return [
        ['direction', p.direction],
        ['speed', p.speed],
        ['out 1', p.out1],
        ['out 2', p.out2],
      ];
    case 'motor':
      return [
        ['direction', p.direction],
        ['speed', p.speed],
      ];
    case 'logic-load':
      return [['input', p.input]];
    case 'signal':
      return [['output', p.output]];
    default: {
      const two = twoLegs(p);
      const names: Record<string, [string, string]> = { led: ['+', '−'], buzzer: ['+', '−'], 'dc-motor': ['+', '−'] };
      const [a, b] = names[p.kind] ?? ['1', '2'];
      return two ? [[a, two[0]], [b, two[1]]] : [];
    }
  }
}

const isPin = (node: string) => /^D\d+$/.test(node);

export function buildSchematic(parts: Part[], board: BoardDefinition): Schematic {
  // Inner points get numbers in the order they are met.
  const points = new Map<string, number>();
  const end = (node: string): NetEnd => {
    if (node === GROUND) return { kind: 'gnd', label: 'GND', node };
    if (node === SUPPLY) return { kind: '5v', label: '5V', node };
    if (isPin(node)) return { kind: 'pin', label: `pin ${pinLabel(board, node)}`, node };
    if (isMotorTerminal(node)) return { kind: 'motor', label: `motor ${node[1]} (${node[1]}0${node[2]})`, node };
    if (!points.has(node)) points.set(node, points.size + 1);
    return { kind: 'net', label: `point ${points.get(node)}`, node };
  };
  const isEnd = (node: string) => node === GROUND || node === SUPPLY || isPin(node) || isMotorTerminal(node);

  const used = new Set<string>();
  const onNode = (node: string) => parts.filter((p) => !used.has(p.id) && legsOf(p).some(([, n]) => n === node));
  const rows: SchematicRow[] = [];

  /** Follow a chain of two-legged parts from `start` while each point in between joins exactly two parts. */
  const walk = (start: string, first: Part): SchematicRow => {
    const items: ChainItem[] = [];
    let node = start;
    let part: Part | undefined = first;
    while (part) {
      const [a, b] = twoLegs(part)!;
      const forward = a === node;
      used.add(part.id);
      items.push({ partId: part.id, kind: part.kind, label: part.label, reversed: POLARISED.has(part.kind) && !forward });
      node = forward ? b : a;
      if (isEnd(node)) break;
      // Continue only through a point that joins just this part and one more two-legged part.
      const next = onNode(node);
      const all = parts.filter((p) => legsOf(p).some(([, n]) => n === node));
      part = next.length === 1 && all.length === 2 && twoLegs(next[0]!) ? next[0] : undefined;
    }
    return { from: end(start), items, to: end(node) };
  };

  // Rows that start at a board pin (in pin order), then at 5V (a part powered straight from 5V).
  const pinNodes = [...new Set(parts.flatMap((p) => legsOf(p).map(([, n]) => n)).filter(isPin))].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  for (const start of [...pinNodes, SUPPLY]) {
    for (let p = onNode(start).find((q) => twoLegs(q)); p; p = onNode(start).find((q) => twoLegs(q))) rows.push(walk(start, p));
  }

  const others: SchematicOther[] = parts
    .filter((p) => !used.has(p.id))
    .map((p) => ({ partId: p.id, kind: p.kind, label: p.label, legs: legsOf(p).map(([leg, n]) => ({ leg, to: end(n) })) }));
  return { rows, others };
}
