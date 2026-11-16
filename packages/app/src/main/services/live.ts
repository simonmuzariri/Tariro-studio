/**
 * Live mode connection: one serial port speaking Firmata (IDE_DESIGN.md §2). The block
 * interpreter runs in the renderer; every pin operation arrives here as a `LiveOp`. No Electron
 * imports; tested against the simulated board.
 */
import { FirmataBoard, type EventPayload, type LiveConnectResult, type LiveOp } from '@tariro-studio/core';
import type { PortBackend, PortHandle } from './serial.js';

/** StandardFirmata's serial speed. */
export const FIRMATA_BAUD = 57600;

export interface LiveEvents {
  state(e: EventPayload<'live:state'>): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class LiveService {
  private port: PortHandle | undefined;
  private board: FirmataBoard | undefined;
  private path: string | undefined;

  constructor(
    private readonly backend: PortBackend,
    private readonly events: LiveEvents,
    /** An Uno restarts when the port opens and the bootloader runs first, so allow a few seconds. */
    private readonly timing = { handshakeMs: 6000, replyMs: 1000 },
  ) {}

  get connectedPort(): string | undefined {
    return this.port?.isOpen ? this.path : undefined;
  }

  async connect(path: string): Promise<LiveConnectResult> {
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
    const name = `${firmware.name.replace(/\.ino$/, '')} ${firmware.version}`;
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

  async io(op: LiveOp): Promise<{ value: number | null } | { error: string }> {
    const board = this.board;
    if (!board || !this.port?.isOpen) return { error: 'The board is not connected.' };
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
