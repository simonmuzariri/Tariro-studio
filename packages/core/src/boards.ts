import type { BoardDefinition, PinKind } from './types.js';

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const ATMEGA328_PINS = {
  digital: range(0, 13),
  analog: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
  pwm: [3, 5, 6, 9, 10, 11],
  i2c: { sda: 'A4', scl: 'A5' },
  spi: { mosi: 11, miso: 12, sck: 13, ss: 10 },
  serial: [{ rx: 0, tx: 1 }],
  builtinLed: 13,
} as const satisfies BoardDefinition['pins'];

const atmega328 = (): BoardDefinition['pins'] => ({
  ...ATMEGA328_PINS,
  digital: [...ATMEGA328_PINS.digital],
  analog: [...ATMEGA328_PINS.analog],
  pwm: [...ATMEGA328_PINS.pwm],
  serial: [...ATMEGA328_PINS.serial],
});

/**
 * Tariro robotics board = Malkon SMRS v0 (Omorfo Tech Labs): ATmega328P @16 MHz, CH340 USB-serial,
 * TB6612FNG dual motor driver, IR receiver, buzzer, RGB LED, ESP-01 socket.
 * Motor pins from the published SMRS pinout: one direction pin and one PWM (enable) pin per
 * motor — INA D4 / ENA D5 (motor A), INB D7 / ENB D6 (motor B).
 */
export const TARIRO: BoardDefinition = {
  id: 'tariro',
  name: 'Tariro Robotics (Malkon SMRS)',
  vendor: 'Omorfo Tech Labs',
  family: 'avr',
  fqbn: 'arduino:avr:uno',
  usb: [{ vid: '1a86', pid: '7523', label: 'CH340' }],
  pins: atmega328(),
  onboard: [
    {
      id: 'motorDriver',
      kind: 'dual-motor-driver',
      pins: { INA: 4, ENA: 5, INB: 7, ENB: 6 },
      confirmed: true,
    },
  ],
  languages: ['arduino'],
  defaultExtensions: ['core', 'io', 'tariro-board'],
  upload: { speed: 115200 },
};

/** Malkon One (Omorfo Tech Labs): Arduino Uno–compatible ATmega328P board with CH340, IR, buzzer, RGB LED, ESP-01 and nRF24L01 sockets. */
export const MALKON_ONE: BoardDefinition = {
  id: 'malkon-one',
  name: 'Malkon One',
  vendor: 'Omorfo Tech Labs',
  family: 'avr',
  fqbn: 'arduino:avr:uno',
  usb: [{ vid: '1a86', pid: '7523', label: 'CH340' }],
  pins: atmega328(),
  languages: ['arduino'],
  defaultExtensions: ['core', 'io'],
  upload: { speed: 115200 },
};

/**
 * Malkon ESP32 (Omorfo Tech Labs): ESP32-S3-WROOM-1 in an Uno-sized board (IoT kit).
 * Pins are ESP32-S3 GPIO numbers. The mapping from the printed header labels (0–13, A0–A5) to
 * GPIOs is not published yet, so the board carries a note until it is confirmed.
 */
export const MALKON_ESP32S3: BoardDefinition = {
  id: 'malkon-esp32s3',
  name: 'Malkon ESP32 (ESP32-S3)',
  vendor: 'Omorfo Tech Labs',
  family: 'esp32',
  fqbn: 'esp32:esp32:esp32s3',
  usb: [{ vid: '303a', pid: '1001', label: 'ESP32-S3 USB' }],
  pins: {
    // Usable GPIOs on an ESP32-S3-WROOM-1: 0 is BOOT, 19/20 are USB, 26–37 are flash/PSRAM.
    digital: [...range(1, 18), 21, ...range(38, 48)],
    // ADC1 channels (keep working while Wi-Fi is on); the core names them A0–A9 = GPIO1–10.
    analog: range(0, 9).map((n) => `A${n}`),
    pwm: [...range(1, 18), 21, ...range(38, 48)],
    i2c: { sda: 8, scl: 9 },
    serial: [{ rx: 44, tx: 43 }],
  },
  languages: ['arduino'],
  defaultExtensions: ['core', 'io'],
  upload: { speed: 921600 },
  notes: ['Pin numbers are ESP32-S3 GPIOs; the mapping to the printed header labels is not yet confirmed.'],
};

export const ARDUINO_UNO: BoardDefinition = {
  id: 'arduino-uno',
  name: 'Arduino Uno',
  vendor: 'Arduino',
  family: 'avr',
  fqbn: 'arduino:avr:uno',
  usb: [
    { vid: '2341', pid: '0043' },
    { vid: '2341', pid: '0001' },
    { vid: '2a03', pid: '0043' },
    { vid: '2341', pid: '0243' },
  ],
  pins: atmega328(),
  languages: ['arduino'],
  defaultExtensions: ['core', 'io'],
  upload: { speed: 115200 },
};

export const ARDUINO_NANO: BoardDefinition = {
  id: 'arduino-nano',
  name: 'Arduino Nano',
  vendor: 'Arduino',
  family: 'avr',
  fqbn: 'arduino:avr:nano:cpu=atmega328',
  usb: [
    { vid: '0403', pid: '6001', label: 'FTDI' },
    { vid: '1a86', pid: '7523', label: 'CH340' },
  ],
  pins: {
    ...ATMEGA328_PINS,
    digital: [...ATMEGA328_PINS.digital],
    analog: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'],
    pwm: [...ATMEGA328_PINS.pwm],
    serial: [...ATMEGA328_PINS.serial],
  },
  languages: ['arduino'],
  defaultExtensions: ['core', 'io'],
  upload: { speed: 115200 },
};

export const ARDUINO_MEGA: BoardDefinition = {
  id: 'arduino-mega',
  name: 'Arduino Mega 2560',
  vendor: 'Arduino',
  family: 'avr',
  fqbn: 'arduino:avr:mega:cpu=atmega2560',
  usb: [
    { vid: '2341', pid: '0010' },
    { vid: '2341', pid: '0042' },
    { vid: '2a03', pid: '0042' },
  ],
  pins: {
    digital: range(0, 53),
    analog: range(0, 15).map((n) => `A${n}`),
    pwm: [...range(2, 13), 44, 45, 46],
    i2c: { sda: 20, scl: 21 },
    spi: { mosi: 51, miso: 50, sck: 52, ss: 53 },
    serial: [
      { rx: 0, tx: 1 },
      { rx: 19, tx: 18 },
      { rx: 17, tx: 16 },
      { rx: 15, tx: 14 },
    ],
    builtinLed: 13,
  },
  languages: ['arduino'],
  defaultExtensions: ['core', 'io'],
  upload: { speed: 115200 },
};

export const BOARDS: readonly BoardDefinition[] = [TARIRO, MALKON_ONE, MALKON_ESP32S3, ARDUINO_UNO, ARDUINO_NANO, ARDUINO_MEGA];
export const DEFAULT_BOARD_ID = TARIRO.id;

export function getBoard(id: string): BoardDefinition {
  const board = BOARDS.find((b) => b.id === id);
  if (!board) throw new Error(`Unknown board "${id}"`);
  return board;
}

/** Pins of a kind, as [label, value] pairs suitable for a dropdown. */
export function pinOptions(board: BoardDefinition, kind: PinKind): Array<[string, string]> {
  const pins =
    kind === 'analog' ? board.pins.analog : (kind === 'pwm' ? board.pins.pwm : board.pins.digital).map(String);
  return pins.map((p) => {
    const label = kind === 'pwm' ? `~${p}` : p;
    return [label, p];
  });
}

/** Pins that onboard peripherals occupy (reusing them for something else needs a warning). */
export function reservedPins(board: BoardDefinition): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of board.onboard ?? []) for (const [sig, pin] of Object.entries(p.pins)) out.set(String(pin), `${p.id}.${sig}`);
  for (const s of board.pins.serial?.slice(0, 1) ?? []) {
    out.set(String(s.rx), 'Serial RX');
    out.set(String(s.tx), 'Serial TX');
  }
  return out;
}

export function isValidPin(board: BoardDefinition, kind: PinKind, pin: string): boolean {
  return pinOptions(board, kind).some(([, v]) => v === pin);
}
