/**
 * The Malkon One board on the workbench: where each header pin is, from Omorfo Tech Labs' 3D model
 * of the board (malkon_one.glb) and its pinout.
 *
 * The model is in millimetres with the board standing "portrait": the digital header runs down
 * its left edge (D0 at the top) and the analog and power headers down its right edge. On the bench
 * it is turned a quarter (`MALKON_ONE_TURN`, about the vertical axis) so the digital header faces
 * the breadboard, D0 on the left: bench x = model z, bench z = −model x.
 *
 * A pin the pinout gives no Arduino pin for (3.3 V, Vin, Reset, IOREF, N/C, the ESP RX/TX and the
 * IR / buzzer / RGB jumpers) is left out: it is drawn by the model but cannot be wired.
 */
import type { BenchPin } from './smrs.js';

/** Turn of the model about the vertical axis on the bench, in radians (three.js `rotation.y`). */
export const MALKON_ONE_TURN = Math.PI / 2;

type Column = { header: string; xModel: number; pins: Array<[string, number]> };

const D0_7 = [-30.331, -27.66, -24.988, -22.317, -19.645, -16.974, -14.302, -11.631];
const D8_ON = [-8.024, -5.438, -2.851, -0.264, 2.323, 4.91, 7.497, 10.083, 12.67, 15.257];
const SENSOR_0_7 = [-29.859, -27.285, -24.712, -22.138, -19.564, -16.99, -14.416, -11.843];
const SENSOR_8_ON = [-7.728, -5.2, -2.672, -0.143, 2.385, 4.913, 7.441, 9.969, 12.497, 15.026];
const ANALOG = [-30.625, -27.888, -25.151, -22.415, -19.678, -16.941];
const ANALOG_SENSOR = [-27.041, -24.565, -22.089, -19.613, -17.137];
const POWER = [-12.417, -9.753, -7.09, -4.427, -1.763, 0.9, 3.563, 6.227];

const all = (pin: string, zs: number[]): Array<[string, number]> => zs.map((z) => [pin, z]);

// The analog header first, so A4 and A5 name its pins; SDA and SCL on the digital header are A4x2 and A5x2.
const COLUMNS: Column[] = [
  { header: 'Analog header', xModel: 24.76, pins: (['A5', 'A4', 'A3', 'A2', 'A1', 'A0'] as const).map((p, i): [string, number] => [p, ANALOG[i]!]) },
  {
    header: 'Digital header',
    xModel: -24.369,
    pins: [
      ...D0_7.map((z, i): [string, number] => [String(i), z]),
      ...(['8', '9', '10', '11', '12', '13', 'GND', null, 'A4', 'A5'] as const).flatMap((p, i): Array<[string, number]> => (p ? [[p, D8_ON[i]!]] : [])), // AREF is not wireable
    ],
  },
  { header: 'Sensor pins (5V)', xModel: -21.323, pins: [...all('5V', SENSOR_0_7), ...all('5V', SENSOR_8_ON)] },
  { header: 'Sensor pins (G)', xModel: -18.88, pins: [...all('GND', SENSOR_0_7), ...all('GND', SENSOR_8_ON)] },
  { header: 'Analog sensor pins (G)', xModel: 18.798, pins: all('GND', ANALOG_SENSOR) },
  { header: 'Analog sensor pins (5V)', xModel: 21.209, pins: all('5V', ANALOG_SENSOR) },
  // Vin, GND, GND, 5V, 3.3V, Reset, IOREF, N/C from the end nearest A0.
  { header: 'Power header', xModel: 24.76, pins: [['GND', POWER[1]!], ['GND', POWER[2]!], ['5V', POWER[3]!]] },
];

/** The wireable pins, in bench orientation (millimetres from the board centre). */
export const MALKON_ONE_PINS: readonly BenchPin[] = (() => {
  const seen: Record<string, number> = {};
  const out: BenchPin[] = [];
  for (const c of COLUMNS)
    for (const [pin, zModel] of c.pins) {
      const n = (seen[pin] = (seen[pin] ?? 0) + 1);
      out.push({ id: n === 1 ? pin : `${pin}x${n}`, pin, header: c.header, x: zModel, z: -c.xModel });
    }
  return out;
})();
