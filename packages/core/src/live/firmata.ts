/**
 * Firmata client for live mode (IDE_DESIGN.md §2): the board runs the open StandardFirmata
 * firmware and the PC drives its pins over the serial port. Pure TypeScript: bytes in, bytes
 * out, timing injected — so it runs in Node tests against a simulated board.
 *
 * Protocol reference: https://github.com/firmata/protocol (protocol version 2.5+).
 */

export const FIRMATA = {
  DIGITAL_MESSAGE: 0x90,
  REPORT_ANALOG: 0xc0,
  REPORT_DIGITAL: 0xd0,
  ANALOG_MESSAGE: 0xe0,
  START_SYSEX: 0xf0,
  SET_PIN_MODE: 0xf4,
  SET_DIGITAL_PIN_VALUE: 0xf5,
  END_SYSEX: 0xf7,
  REPORT_VERSION: 0xf9,
  SYSTEM_RESET: 0xff,
  // sysex commands
  ANALOG_MAPPING_QUERY: 0x69,
  ANALOG_MAPPING_RESPONSE: 0x6a,
  EXTENDED_ANALOG: 0x6f,
  STRING_DATA: 0x71,
  REPORT_FIRMWARE: 0x79,
  SAMPLING_INTERVAL: 0x7a,
} as const;

export type LivePinMode = 'input' | 'input_pullup' | 'output' | 'analog' | 'pwm' | 'servo';
const MODE_CODE: Record<LivePinMode, number> = { input: 0, output: 1, analog: 2, pwm: 3, servo: 4, input_pullup: 11 };

export type FirmataMessage =
  | { type: 'version'; major: number; minor: number }
  | { type: 'firmware'; major: number; minor: number; name: string }
  | { type: 'analog'; channel: number; value: number }
  | { type: 'digital'; port: number; mask: number }
  | { type: 'analog-mapping'; channels: number[] }
  | { type: 'string'; text: string };

const pairs = (data: number[]): string => {
  let out = '';
  for (let i = 0; i + 1 < data.length; i += 2) out += String.fromCharCode((data[i]! & 0x7f) | ((data[i + 1]! & 0x7f) << 7));
  return out;
};

/** Incremental parser for the board → PC byte stream. Unknown messages are skipped. */
export class FirmataParser {
  private command = 0;
  private data: number[] = [];
  private sysex: number[] | undefined;

  push(bytes: Iterable<number>): FirmataMessage[] {
    const out: FirmataMessage[] = [];
    for (const b of bytes) {
      if (this.sysex) {
        if (b === FIRMATA.END_SYSEX) {
          const m = this.sysexMessage(this.sysex);
          if (m) out.push(m);
          this.sysex = undefined;
        } else if (b & 0x80) {
          this.sysex = undefined; // a new command inside sysex: the message was cut short
          this.start(b);
        } else if (this.sysex.length < 4096) this.sysex.push(b);
        continue;
      }
      if (b & 0x80) {
        this.start(b);
        continue;
      }
      if (!this.command) continue;
      this.data.push(b);
      if (this.data.length < 2) continue;
      const [lsb, msb] = this.data as [number, number];
      const high = this.command & 0xf0;
      if (this.command === FIRMATA.REPORT_VERSION) out.push({ type: 'version', major: lsb, minor: msb });
      else if (high === FIRMATA.ANALOG_MESSAGE) out.push({ type: 'analog', channel: this.command & 0x0f, value: lsb | (msb << 7) });
      else if (high === FIRMATA.DIGITAL_MESSAGE) out.push({ type: 'digital', port: this.command & 0x0f, mask: lsb | (msb << 7) });
      this.command = 0;
      this.data = [];
    }
    return out;
  }

  private start(b: number): void {
    this.data = [];
    if (b === FIRMATA.START_SYSEX) {
      this.sysex = [];
      this.command = 0;
      return;
    }
    const high = b & 0xf0;
    this.command = b === FIRMATA.REPORT_VERSION || high === FIRMATA.ANALOG_MESSAGE || high === FIRMATA.DIGITAL_MESSAGE ? b : 0;
  }

  private sysexMessage(s: number[]): FirmataMessage | undefined {
    const [cmd, ...rest] = s;
    if (cmd === FIRMATA.REPORT_FIRMWARE && rest.length >= 2) return { type: 'firmware', major: rest[0]!, minor: rest[1]!, name: pairs(rest.slice(2)) };
    if (cmd === FIRMATA.ANALOG_MAPPING_RESPONSE) return { type: 'analog-mapping', channels: rest };
    if (cmd === FIRMATA.STRING_DATA) return { type: 'string', text: pairs(rest) };
    return undefined;
  }
}

/** What live-mode blocks can do to a board. Implemented by `FirmataBoard`; faked in tests. */
export interface LiveBoard {
  digitalWrite(pin: number, on: boolean): Promise<void>;
  /** PWM duty 0–255. */
  analogWrite(pin: number, value: number): Promise<void>;
  /** Servo angle 0–180. */
  servoWrite(pin: number, angle: number): Promise<void>;
  digitalRead(pin: number, pullup: boolean): Promise<boolean>;
  /** Analog channel (0 for A0…); 0–1023. */
  analogRead(channel: number): Promise<number>;
  /** Digital pin number of an analog channel (A0 is 14 on an Uno), if the board has it. */
  analogPin(channel: number): Promise<number | undefined>;
}

export interface FirmataTiming {
  sleep(ms: number): Promise<void>;
  now(): number;
  /** How long to wait for a first reading or reply. */
  replyMs: number;
}

export class FirmataError extends Error {}

/** One board speaking StandardFirmata. `write` sends bytes; feed received bytes to `receive`. */
export class FirmataBoard implements LiveBoard {
  private readonly parser = new FirmataParser();
  private readonly modes = new Map<number, LivePinMode>();
  private readonly digitalPorts = new Map<number, number>();
  private readonly reportingPorts = new Set<number>();
  private readonly analogValues = new Map<number, number>();
  private readonly reportingChannels = new Set<number>();
  /** Index = pin, value = analog channel or 127. */
  private mapping: number[] | undefined;
  firmware: { name: string; version: string } | undefined;

  constructor(
    private readonly write: (bytes: Uint8Array) => void | Promise<void>,
    private readonly timing: FirmataTiming,
  ) {}

  receive(bytes: Iterable<number>): void {
    for (const m of this.parser.push(bytes)) {
      if (m.type === 'firmware') this.firmware = { name: m.name, version: `${m.major}.${m.minor}` };
      else if (m.type === 'analog') this.analogValues.set(m.channel, m.value);
      else if (m.type === 'digital') this.digitalPorts.set(m.port, m.mask);
      else if (m.type === 'analog-mapping') this.mapping = m.channels;
    }
  }

  private send(...bytes: number[]): Promise<void> {
    return Promise.resolve(this.write(Uint8Array.from(bytes)));
  }

  private async until<T>(read: () => T | undefined, ms: number, retry?: () => Promise<void>, retryEveryMs = 1000): Promise<T | undefined> {
    const end = this.timing.now() + ms;
    let nextRetry = this.timing.now() + retryEveryMs;
    for (;;) {
      const v = read();
      if (v !== undefined) return v;
      const now = this.timing.now();
      if (now >= end) return undefined;
      if (retry && now >= nextRetry) {
        nextRetry = now + retryEveryMs;
        await retry();
      }
      await this.timing.sleep(5);
    }
  }

  /**
   * Wait for the firmware to introduce itself (an Uno restarts when the port opens, so this
   * can take a couple of seconds), then learn which pins are analog inputs.
   */
  async handshake(timeoutMs: number): Promise<{ name: string; version: string } | undefined> {
    const ask = () => this.send(FIRMATA.START_SYSEX, FIRMATA.REPORT_FIRMWARE, FIRMATA.END_SYSEX);
    const fw = await this.until(() => this.firmware, timeoutMs, ask);
    if (!fw) return undefined;
    await this.send(FIRMATA.START_SYSEX, FIRMATA.ANALOG_MAPPING_QUERY, FIRMATA.END_SYSEX);
    await this.until(() => this.mapping, this.timing.replyMs * 4);
    await this.send(FIRMATA.START_SYSEX, FIRMATA.SAMPLING_INTERVAL, 20, 0, FIRMATA.END_SYSEX);
    return fw;
  }

  /** Put every pin back to the firmware's defaults (outputs off, reporting off). */
  async reset(): Promise<void> {
    this.modes.clear();
    this.digitalPorts.clear();
    this.reportingPorts.clear();
    this.analogValues.clear();
    this.reportingChannels.clear();
    await this.send(FIRMATA.SYSTEM_RESET);
  }

  private checkPin(pin: number): void {
    if (!Number.isInteger(pin) || pin < 0 || pin > 127) throw new FirmataError(`Pin ${pin} is not a pin on this board.`);
  }

  /** Returns true when the mode had to change. */
  private async mode(pin: number, mode: LivePinMode): Promise<boolean> {
    this.checkPin(pin);
    if (this.modes.get(pin) === mode) return false;
    this.modes.set(pin, mode);
    await this.send(FIRMATA.SET_PIN_MODE, pin, MODE_CODE[mode]);
    return true;
  }

  async digitalWrite(pin: number, on: boolean): Promise<void> {
    await this.mode(pin, 'output');
    await this.send(FIRMATA.SET_DIGITAL_PIN_VALUE, pin, on ? 1 : 0);
  }

  private async analogMessage(pin: number, value: number): Promise<void> {
    const v = Math.max(0, Math.round(value)) & 0x3fff;
    if (pin < 16) await this.send(FIRMATA.ANALOG_MESSAGE | pin, v & 0x7f, v >> 7);
    else await this.send(FIRMATA.START_SYSEX, FIRMATA.EXTENDED_ANALOG, pin, v & 0x7f, v >> 7, FIRMATA.END_SYSEX);
  }

  async analogWrite(pin: number, value: number): Promise<void> {
    await this.mode(pin, 'pwm');
    await this.analogMessage(pin, Math.min(Math.max(value, 0), 255));
  }

  async servoWrite(pin: number, angle: number): Promise<void> {
    await this.mode(pin, 'servo');
    await this.analogMessage(pin, Math.min(Math.max(angle, 0), 180));
  }

  async digitalRead(pin: number, pullup: boolean): Promise<boolean> {
    const changed = await this.mode(pin, pullup ? 'input_pullup' : 'input');
    const port = pin >> 3;
    if (changed || !this.reportingPorts.has(port)) {
      // (Re-)enabling the report makes the firmware send the port's current value at once.
      this.reportingPorts.add(port);
      this.digitalPorts.delete(port);
      await this.send(FIRMATA.REPORT_DIGITAL | port, 1);
    }
    const mask = await this.until(() => this.digitalPorts.get(port), this.timing.replyMs);
    if (mask === undefined) throw new FirmataError('The board did not answer. Check the USB cable.');
    return ((mask >> (pin & 7)) & 1) === 1;
  }

  async analogPin(channel: number): Promise<number | undefined> {
    const i = this.mapping?.indexOf(channel) ?? -1;
    return i >= 0 ? i : undefined;
  }

  async analogRead(channel: number): Promise<number> {
    if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new FirmataError(`A${channel} is not an analog pin on this board.`);
    if (!this.reportingChannels.has(channel)) {
      const pin = await this.analogPin(channel);
      if (this.mapping && pin === undefined) throw new FirmataError(`A${channel} is not an analog pin on this board.`);
      if (pin !== undefined) await this.mode(pin, 'analog');
      this.reportingChannels.add(channel);
      this.analogValues.delete(channel);
      await this.send(FIRMATA.REPORT_ANALOG | channel, 1);
    }
    const v = await this.until(() => this.analogValues.get(channel), this.timing.replyMs);
    if (v === undefined) throw new FirmataError('The board did not answer. Check the USB cable.');
    return v;
  }
}
