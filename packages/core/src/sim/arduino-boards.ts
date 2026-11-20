/**
 * The Arduino Uno, Nano and Mega 2560 on the workbench, laid out like the real boards: the size of
 * the board and where each header pin is, from the published board outlines (to within about a
 * millimetre, which is all the workbench needs). Only pins the simulator knows are wireable; the
 * others (AREF, 3.3 V, RESET, VIN…) are drawn but cannot take a wire, as on the Tariro model.
 *
 * Coordinates: millimetres from the board's centre, x to the right, z towards the learner, with the
 * board lying the way it is drawn in its outline (USB socket on the left).
 */
import type { BenchPin } from './smrs.js';

export type ArduinoModel = 'uno' | 'nano' | 'mega';

export interface BoardHeader {
  label: string;
  /** Female sockets (Uno, Mega) or male pins (Nano). */
  kind: 'female' | 'male';
  /** Pins in order; null = drawn but not wireable. */
  pins: ReadonlyArray<string | null>;
  /** First pin, in the outline's own millimetres (origin at the bottom-left corner, y up). */
  x: number;
  y: number;
  /** Step from one pin to the next. */
  dx: number;
  dy: number;
}

export interface BoardOutline {
  width: number;
  depth: number;
  /** PCB colour. */
  colour: number;
  headers: readonly BoardHeader[];
  /** Parts drawn on top: [kind, x, y, width, depth] in outline millimetres. */
  features: ReadonlyArray<readonly ['usb-b' | 'usb-mini' | 'jack' | 'chip' | 'small-chip', number, number, number, number]>;
}

const P = 2.54;
const digits = (from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => String(from < to ? from + i : from - i));

/** The Uno's headers (the analog header first, so 'A4' is the A4 socket and its SDA copy is 'A4x2'). */
const UNO_HEADERS: BoardHeader[] = [
  // Along the front edge, left to right.
  { label: 'Analog header A0–A5', kind: 'female', pins: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'], x: 50.8, y: 2.54, dx: P, dy: 0 },
  { label: 'Power header (IOREF, RESET, 3.3V, 5V, GND, GND, VIN)', kind: 'female', pins: [null, null, null, null, '5V', 'GND', 'GND', null], x: 27.94, y: 2.54, dx: P, dy: 0 },
  // Along the back edge, right to left: D0–D7, then (after the famous 0.06" gap) D8–D13, GND, AREF, SDA, SCL.
  { label: 'Digital header D0–D7', kind: 'female', pins: digits(0, 7), x: 63.5, y: 50.8, dx: -P, dy: 0 },
  { label: 'Digital header D8–D13 (GND, AREF, SDA, SCL)', kind: 'female', pins: [...digits(8, 13), 'GND', null, 'A4', 'A5'], x: 41.66, y: 50.8, dx: -P, dy: 0 },
];

export const BOARD_OUTLINES: Record<ArduinoModel, BoardOutline> = {
  uno: {
    width: 68.58,
    depth: 53.34,
    colour: 0x0b6d7a,
    headers: UNO_HEADERS,
    features: [
      ['usb-b', -6.2, 38.1, 16, 12],
      ['jack', -1.8, 7.6, 13.5, 9],
      ['chip', 33, 18, 35, 9],
      ['small-chip', 18, 38, 7, 7],
    ],
  },
  mega: {
    width: 101.6,
    depth: 53.34,
    colour: 0x0b6d7a,
    headers: [
      { label: 'Analog header A0–A7', kind: 'female', pins: digits(0, 7).map((n) => `A${n}`), x: 50.8, y: 2.54, dx: P, dy: 0 },
      { label: 'Analog header A8–A15', kind: 'female', pins: digits(8, 15).map((n) => `A${n}`), x: 73.66, y: 2.54, dx: P, dy: 0 },
      UNO_HEADERS[1]!,
      UNO_HEADERS[2]!,
      { label: 'Communication header D14–D21', kind: 'female', pins: digits(14, 21), x: 66.04, y: 50.8, dx: P, dy: 0 },
      // On the Mega, SDA and SCL are D20 and D21 (on the Uno they are A4 and A5); listed after D20 and D21 themselves.
      { ...UNO_HEADERS[3]!, label: 'Digital header D8–D13 (GND, AREF, SDA = D20, SCL = D21)', pins: [...digits(8, 13), 'GND', null, '20', '21'] },
      // Two rows along the right edge: 5V, 5V, D22/D23 … D52/D53, GND, GND.
      { label: 'Double header D22–D52 (even)', kind: 'female', pins: ['5V', ...digits(22, 52).filter((n) => Number(n) % 2 === 0), 'GND'], x: 93.98, y: 48.26, dx: 0, dy: -P },
      { label: 'Double header D23–D53 (odd)', kind: 'female', pins: ['5V', ...digits(23, 53).filter((n) => Number(n) % 2 === 1), 'GND'], x: 96.52, y: 48.26, dx: 0, dy: -P },
    ],
    features: [
      ['usb-b', -6.2, 38.1, 16, 12],
      ['jack', -1.8, 7.6, 13.5, 9],
      ['chip', 52, 26, 17, 17],
      ['small-chip', 18, 38, 7, 7],
    ],
  },
  nano: {
    width: 43.18,
    depth: 17.78,
    colour: 0x1c5fa8,
    headers: [
      // Back row from the USB end: D12 … D2, GND, RESET, RX (D0), TX (D1).
      { label: 'Pin row D12–D2, GND, RESET, D0, D1', kind: 'male', pins: [...digits(12, 2), 'GND', null, '0', '1'], x: 3.81, y: 16.51, dx: P, dy: 0 },
      // Front row from the USB end: D13, 3.3V, AREF, A0 … A7, 5V, RESET, GND, VIN.
      { label: 'Pin row D13, 3.3V, AREF, A0–A7, 5V, RESET, GND, VIN', kind: 'male', pins: ['13', null, null, ...digits(0, 7).map((n) => `A${n}`), '5V', null, 'GND', null], x: 3.81, y: 1.27, dx: P, dy: 0 },
    ],
    features: [
      ['usb-mini', -1.5, 8.89, 9, 7.5],
      ['chip', 26, 8.89, 7, 7],
    ],
  },
};

/** Every header position in bench millimetres (from the board's centre), null pins included. */
export function headerPositions(outline: BoardOutline, h: BoardHeader): Array<{ pin: string | null; x: number; z: number }> {
  return h.pins.map((pin, i) => ({ pin, x: h.x + i * h.dx - outline.width / 2, z: -(h.y + i * h.dy - outline.depth / 2) }));
}

/** The wireable pins of a model; extra pins of the same signal are numbered from 2 ('GNDx2', 'A4x2'). */
export function arduinoPins(model: ArduinoModel): BenchPin[] {
  const outline = BOARD_OUTLINES[model];
  const seen: Record<string, number> = {};
  const out: BenchPin[] = [];
  for (const h of outline.headers)
    for (const p of headerPositions(outline, h)) {
      if (!p.pin) continue;
      const n = (seen[p.pin] = (seen[p.pin] ?? 0) + 1);
      out.push({ id: n === 1 ? p.pin : `${p.pin}x${n}`, pin: p.pin, header: h.label, x: p.x, z: p.z });
    }
  return out;
}

export const UNO_PINS = arduinoPins('uno');
export const NANO_PINS = arduinoPins('nano');
export const MEGA_PINS = arduinoPins('mega');
