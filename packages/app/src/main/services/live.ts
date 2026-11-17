/**
 * Live mode connection: one serial port speaking Firmata (IDE_DESIGN.md §2). The block
 * interpreter runs in the renderer; every pin operation arrives here as a `LiveOp`. No Electron
 * imports; tested against the simulated board.
 */
import { FirmataBoard, SafetyLayer, type BoardDefinition, type EventPayload, type LiveConnectResult, type LiveOp, type SafetySettings } from '@tariro-studio/core';
import type { PortBackend, PortHandle } from './serial.js';

/** StandardFirmata's serial speed. */
export const FIRMATA_BAUD = 57600;

export interface LiveEvents {
  state(e: EventPayload<'live:state'>): void;
  /** A command the safety layer limited or refused, the watchdog, the emergency stop. */
  safety?(e: EventPayload<'live:safety'>): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class LiveService {
  private port: PortHandle | undefined;
  private board: FirmataBoard | undefined;
  private path: string | undefined;
  /** Every command passes through it (EXPANSION_PLAN A4). */
  readonly safety = new SafetyLayer();
  private readonly reported = new Map<string, number>();

  constructor(
    private readonly backend: PortBackend,
    private readonly events: LiveEvents,
    /** An Uno restarts when the port opens and the bootloader runs first, so allow a few seconds. */
    private readonly timing = { handshakeMs: 6000, replyMs: 1000 },
  ) {}

  get connectedPort(): string | undefined {
    return this.port?.isOpen ? this.path : undefined;
  }

  configureSafety(board: BoardDefinition | undefined, settings: Partial<SafetySettings>): void {
    this.safety.configure(board, settings);
  }

  /** Report a safety event at most once a second per message (a loop must not flood the log). */
  private report(kind: EventPayload<'live:safety'>['kind'], message: string, now = Date.now()): void {
    const key = `${kind}:${message}`;
    if (now - (this.reported.get(key) ?? 0) < 1000) return;
    this.reported.set(key, now);
    this.events.safety?.({ kind, message });
  }

  heartbeat(now = Date.now()): void {
    this.safety.heartbeat(now);
  }

  /** The watchdog: called a few times a second; switches the board off if the app went silent. */
  async checkWatchdog(now = Date.now()): Promise<void> {
    if (!this.port?.isOpen || !this.safety.watchdogExpired(now)) return;
    const path = this.path;
    await this.disconnect(true);
    const message = 'Safety: Tariro Studio stopped responding, so the board was switched off.';
    this.report('watchdog', message, now);
    this.events.state({ connected: false, ...(path ? { port: path } : {}), error: message });
  }

  /** Emergency stop: every pin off now, and nothing more until reset. */
  async emergencyStop(): Promise<void> {
    this.safety.emergencyStop();
    const path = this.path;
    await this.disconnect(true);
    this.report('estop', 'Emergency stop: the board was switched off. Press Reset to drive it again.');
    this.events.state({ connected: false, ...(path ? { port: path } : {}), estop: true, error: 'Emergency stop.' });
  }

  resetEmergencyStop(): void {
    this.safety.reset();
    this.events.state({ connected: false, estop: false });
  }

  async connect(path: string): Promise<LiveConnectResult> {
    if (this.safety.emergencyStopped)
      return { ok: false, needsFirmware: false, message: 'The emergency stop is on. Press Reset to drive the board again.' };
    await this.disconnect(false);
    let port: PortHandle;
    try {
      port = await this.backend.open(path, FIRMATA_BAUD);
    } catch (err) {
      return { ok: false, needsFirmware: false, message: `The port could not be opened: ${(err as Error).message}` };
    }
    const write = (bytes: Uint8Array) =>
      new Promise<void>((resolve, reject) => {
        if (!port.isOpen) return reject(new Error('The board was disconnected.'));
        port.write(Buffer.from(bytes), (e) => (e ? reject(e) : resolve()));
      });
    const board = new FirmataBoard(write, { sleep, now: () => Date.now(), replyMs: this.timing.replyMs });
    port.on('data', (chunk) => board.receive(chunk));
    port.on('close', () => {
      if (this.port !== port) return;
      this.port = undefined;
      this.board = undefined;
      this.events.state({ connected: false, port: path, error: 'The board was disconnected.' });
    });
    port.on('error', () => {});
    let firmware: { name: string; version: string } | undefined;
    try {
      firmware = await board.handshake(this.timing.handshakeMs);
    } catch {
      firmware = undefined;
    }
    if (!firmware) {
      await close(port);
      return { ok: false, needsFirmware: true, message: 'The board did not answer as a live-mode board. It needs the live firmware (Firmata).' };
    }
    this.port = port;
    this.board = board;
    this.path = path;
    this.safety.heartbeat(Date.now()); // the watchdog starts now
    // Firmata reports the sketch file name; ours is compiled as "sketch.ino".
    const sketch = firmware.name.replace(/\.ino$/, '');
    const name = `${sketch === 'sketch' ? 'StandardFirmata' : sketch} ${firmware.version}`;
    this.events.state({ connected: true, port: path, firmware: name });
    return { ok: true, needsFirmware: false, message: `Connected to ${name} on ${path}.` };
  }

  async disconnect(reset: boolean): Promise<boolean> {
    const port = this.port;
    const board = this.board;
    const path = this.path;
    this.port = undefined;
    this.board = undefined;
    if (!port) return false;
    if (reset && port.isOpen) {
      try {
        await board?.reset();
        await sleep(30); // let the reset byte leave before the port closes
      } catch {
        /* the board is gone; nothing to reset */
      }
    }
    await close(port);
    this.events.state({ connected: false, ...(path ? { port: path } : {}) });
    return true;
  }

  async io(request: LiveOp): Promise<{ value: number | null } | { error: string }> {
    const board = this.board;
    if (!board || !this.port?.isOpen) return { error: 'The board is not connected.' };
    const verdict = this.safety.check(request, Date.now());
    if (!verdict.allow) {
      this.report('blocked', verdict.reason);
      return { error: verdict.reason };
    }
    if (verdict.note) this.report('limited', verdict.note);
    const op = verdict.op;
    try {
      switch (op.op) {
        case 'digitalWrite':
          await board.digitalWrite(op.pin, op.on);
          return { value: null };
        case 'analogWrite':
          await board.analogWrite(op.pin, op.value);
          return { value: null };
        case 'servoWrite':
          await board.servoWrite(op.pin, op.angle);
          return { value: null };
        case 'digitalRead':
          return { value: (await board.digitalRead(op.pin, op.pullup)) ? 1 : 0 };
        case 'analogRead':
          return { value: await board.analogRead(op.channel) };
        case 'analogPin':
          return { value: (await board.analogPin(op.channel)) ?? null };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function close(port: PortHandle): Promise<void> {
  return new Promise((resolve) => (port.isOpen ? port.close(() => resolve()) : resolve()));
}
