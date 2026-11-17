/**
 * The Malkon SMRS board (the Tariro robot's controller) as it sits on the workbench: where each
 * header is and which pin each header position is, from Omorfo Tech Labs' board photo and pinout.
 *
 * Positions are measured on the board photo (1200 × 800 px; the board is 68.6 mm = 777 px wide)
 * and turned into millimetres from the board centre, x to the right and z towards the learner.
 * The 3D model in the app is drawn from the same numbers, so a pin in the picture is exactly the
 * pin the wiring rules use.
 *
 * A null pin is a header position whose signal is not confirmed by the pinout (the second row of
 * the servo header, the serial and ESP headers, the IR / buzzer / RGB jumpers): it is drawn but
 * cannot be wired, so the bench never invents a connection the real board may not have.
 */

export const SMRS_PHOTO = { width: 1200, height: 800 } as const;
/** Millimetres per photo pixel. */
export const SMRS_MM_PER_PX = 68.6 / 777;
/** The photo pixel at the board centre. */
const CX = 616;
const CY = 395;

/** Photo pixel → millimetres from the board centre. */
export function smrsMm(px: number, py: number): { x: number; z: number } {
  return { x: (px - CX) * SMRS_MM_PER_PX, z: (py - CY) * SMRS_MM_PER_PX };
}

export interface SmrsHeader {
  /** What the learner sees when pointing at it. */
  label: string;
  kind: 'female' | 'male';
  /** Header body on the photo: [left, top, right, bottom] in pixels. */
  rect: readonly [number, number, number, number];
  cols: number;
  rows: number;
  /** Pin at each position, row by row from the back of the board; null = not confirmed, not wireable. */
  pins: ReadonlyArray<string | null>;
}

const none = (n: number) => Array<null>(n).fill(null);

export const SMRS_HEADERS: readonly SmrsHeader[] = [
  { label: 'Digital header D12–D13', kind: 'female', rect: [420, 97, 600, 132], cols: 6, rows: 1, pins: ['5V', 'GND', '13', '12', '5V', 'GND'] },
  // The front row of this header is printed upside down on the photo and is not in the pinout yet.
  { label: 'Servo header D10–D11 (G / 5V / signal)', kind: 'male', rect: [610, 103, 780, 165], cols: 6, rows: 2, pins: ['GND', '5V', '10', '11', 'GND', '5V', ...none(6)] },
  { label: 'Digital header D2–D3', kind: 'female', rect: [785, 97, 975, 132], cols: 6, rows: 1, pins: ['GND', '5V', '2', '3', 'GND', '5V'] },
  { label: 'Serial pins (not on the workbench yet)', kind: 'male', rect: [790, 137, 970, 165], cols: 6, rows: 1, pins: none(6) },
  { label: 'ICSP header', kind: 'male', rect: [905, 185, 965, 265], cols: 2, rows: 3, pins: none(6) },
  { label: 'Analog header A0–A5 (signal / G)', kind: 'male', rect: [735, 597, 910, 657], cols: 6, rows: 2, pins: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'GND', 'GND', 'GND', 'GND', 'GND', 'GND'] },
  { label: 'Analog header 5V row', kind: 'female', rect: [735, 660, 915, 693], cols: 6, rows: 1, pins: ['5V', '5V', '5V', '5V', '5V', '5V'] },
  { label: 'IR / buzzer pin jumpers', kind: 'male', rect: [295, 315, 330, 362], cols: 2, rows: 2, pins: none(4) },
  { label: '3V3 jumper', kind: 'male', rect: [395, 342, 470, 368], cols: 3, rows: 1, pins: none(3) },
  { label: 'RGB LED pin jumpers', kind: 'male', rect: [358, 452, 390, 537], cols: 1, rows: 3, pins: none(3) },
  { label: 'RX / TX header', kind: 'male', rect: [598, 655, 655, 682], cols: 2, rows: 1, pins: none(2) },
];

/** A wireable pin on a board drawn as its real model on the workbench. */
export interface BenchPin {
  /** Connection name: '13', 'A0', '5V', 'GND', or another pin of the same signal: 'GNDx2', 'A4x2'… */
  id: string;
  /** The pin it is electrically: 'GNDx2' is 'GND'. */
  pin: string;
  header: string;
  x: number;
  z: number;
}

/** Every header position with its centre in millimetres (null pins included, for drawing). */
export function smrsHeaderPositions(h: SmrsHeader): Array<{ pin: string | null; x: number; z: number }> {
  const [x1, y1, x2, y2] = h.rect;
  const out: Array<{ pin: string | null; x: number; z: number }> = [];
  for (let r = 0; r < h.rows; r++)
    for (let c = 0; c < h.cols; c++) {
      const p = smrsMm(x1 + ((c + 0.5) * (x2 - x1)) / h.cols, y1 + ((r + 0.5) * (y2 - y1)) / h.rows);
      out.push({ pin: h.pins[r * h.cols + c] ?? null, ...p });
    }
  return out;
}

/** @deprecated name kept for readers of older code. */
export type SmrsPin = BenchPin;

/** The wireable pins, each with its own connection name. Extra 5V and GND pins are numbered from 2. */
export const SMRS_PINS: readonly BenchPin[] = (() => {
  const seen: Record<string, number> = {};
  const out: BenchPin[] = [];
  for (const h of SMRS_HEADERS)
    for (const p of smrsHeaderPositions(h)) {
      if (!p.pin) continue;
      const n = (seen[p.pin] = (seen[p.pin] ?? 0) + 1);
      out.push({ id: n === 1 ? p.pin : `${p.pin}x${n}`, pin: p.pin, header: h.label, x: p.x, z: p.z });
    }
  return out;
})();
