/**
 * A simulated Uno running StandardFirmata, for tests and for the development mock port. It
 * answers the subset of the protocol that `FirmataBoard` uses and records what the pins were
 * told to do. It is not used with real boards.
 */
import { FIRMATA } from './firmata.js';

const MODE_NAME: Record<number, string> = { 0: 'input', 1: 'output', 2: 'analog', 3: 'pwm', 4: 'servo', 11: 'input_pullup' };
const sevenBit = (text: string): number[] => [...text].flatMap((c) => [c.charCodeAt(0) & 0x7f, (c.charCodeAt(0) >> 7) & 0x7f]);

export interface SimPin {
  mode: string;
  /** Last value written: 0/1 for outputs, duty for PWM, angle for servo. */
  value: number;
}

export class SimulatedFirmataBoard {
  readonly pins = new Map<number, SimPin>();
  /** Every pin write in order, e.g. "13=1", "5~153" (PWM), "9^90" (servo). */
  readonly writes: string[] = [];
  private readonly inputs = new Map<number, boolean>();
  private readonly analog = new Map<number, number>();
  private readonly reportPorts = new Set<number>();
  private readonly reportChannels = new Set<number>();
  private buffer: number[] = [];
  resets = 0;

  /** `send` delivers bytes to the PC. 20 pins: D0–D13, A0–A5 as 14–19. */
  constructor(private readonly send: (bytes: Uint8Array) => void) {}

  private out(...bytes: number[]): void {
    this.send(Uint8Array.from(bytes));
  }

  /** What the firmware sends when the board starts. */
  powerUp(): void {
    this.out(FIRMATA.REPORT_VERSION, 2, 5);
    this.out(FIRMATA.START_SYSEX, FIRMATA.REPORT_FIRMWARE, 2, 5, ...sevenBit('StandardFirmata.ino'), FIRMATA.END_SYSEX);
  }

  /** Change what a digital input pin sees. */
  setInput(pin: number, high: boolean): void {
    this.inputs.set(pin, high);
    if (this.reportPorts.has(pin >> 3)) this.sendPort(pin >> 3);
  }

  /** Change what an analog channel reads (0–1023). */
  setAnalog(channel: number, value: number): void {
    this.analog.set(channel, value);
    if (this.reportChannels.has(channel)) this.sendAnalog(channel);
  }

  private sendPort(port: number): void {
    let mask = 0;
    for (let bit = 0; bit < 8; bit++) {
      const pin = port * 8 + bit;
      const mode = this.pins.get(pin)?.mode;
      if (mode !== 'input' && mode !== 'input_pullup') continue;
      if (this.inputs.get(pin) ?? mode === 'input_pullup') mask |= 1 << bit;
    }
    this.out(FIRMATA.DIGITAL_MESSAGE | port, mask & 0x7f, mask >> 7);
  }

  private sendAnalog(channel: number): void {
    const v = this.analog.get(channel) ?? 0;
    this.out(FIRMATA.ANALOG_MESSAGE | channel, v & 0x7f, v >> 7);
  }

  private write(pin: number, value: number): void {
    const p = this.pins.get(pin) ?? { mode: 'output', value: 0 };
    p.value = value;
    this.pins.set(pin, p);
    this.writes.push(p.mode === 'pwm' ? `${pin}~${value}` : p.mode === 'servo' ? `${pin}^${value}` : `${pin}=${value}`);
  }

  /** Bytes from the PC. */
  receive(bytes: Iterable<number>): void {
    this.buffer.push(...bytes);
    for (;;) {
      const b = this.buffer;
      const cmd = b[0];
      if (cmd === undefined) return;
      const high = cmd & 0xf0;
      if (cmd === FIRMATA.START_SYSEX) {
        const end = b.indexOf(FIRMATA.END_SYSEX);
        if (end < 0) return;
        this.sysex(b.slice(1, end));
        this.buffer = b.slice(end + 1);
      } else if (cmd === FIRMATA.SYSTEM_RESET) {
        this.pins.clear();
        this.reportPorts.clear();
        this.reportChannels.clear();
        this.resets++;
        this.buffer = b.slice(1);
      } else if (cmd === FIRMATA.SET_PIN_MODE || cmd === FIRMATA.SET_DIGITAL_PIN_VALUE || high === FIRMATA.ANALOG_MESSAGE) {
        if (b.length < 3) return;
        const [, x, y] = b as [number, number, number];
        if (cmd === FIRMATA.SET_PIN_MODE) this.pins.set(x, { mode: MODE_NAME[y] ?? `mode${y}`, value: 0 });
        else if (cmd === FIRMATA.SET_DIGITAL_PIN_VALUE) this.write(x, y);
        else this.write(cmd & 0x0f, x | (y << 7));
        this.buffer = b.slice(3);
      } else if (high === FIRMATA.REPORT_DIGITAL || high === FIRMATA.REPORT_ANALOG) {
        if (b.length < 2) return;
        const n = cmd & 0x0f;
        const set = high === FIRMATA.REPORT_DIGITAL ? this.reportPorts : this.reportChannels;
        if (b[1]) {
          set.add(n);
          if (high === FIRMATA.REPORT_DIGITAL) this.sendPort(n);
          else this.sendAnalog(n);
        } else set.delete(n);
        this.buffer = b.slice(2);
      } else this.buffer = b.slice(1); // unknown byte
    }
  }

  private sysex(s: number[]): void {
    const [cmd, ...rest] = s;
    if (cmd === FIRMATA.REPORT_FIRMWARE) this.powerUp();
    else if (cmd === FIRMATA.ANALOG_MAPPING_QUERY)
      this.out(FIRMATA.START_SYSEX, FIRMATA.ANALOG_MAPPING_RESPONSE, ...Array.from({ length: 20 }, (_, pin) => (pin >= 14 ? pin - 14 : 127)), FIRMATA.END_SYSEX);
    else if (cmd === FIRMATA.EXTENDED_ANALOG && rest.length >= 3) this.write(rest[0]!, rest[1]! | (rest[2]! << 7));
  }
}
