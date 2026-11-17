import type { LiveOp } from '@tariro-studio/core';
import type { StageBoardIO } from '@tariro-studio/extensions';

/** How often the inputs a stage program reads are refreshed (about 30 times a second). */
const POLL_MS = 33;

/**
 * The board as Stage mode sees it, over the live-mode USB link. Stage programs run frame by
 * frame and cannot wait, so pin writes go into an ordered queue and reads answer at once from the
 * latest values, which a poll loop keeps fresh for every input the program has asked about.
 * Nothing connects until the program first uses a board block.
 */
export class StageLink implements StageBoardIO {
  private queue: Promise<void> = Promise.resolve();
  private connecting: Promise<boolean> | null = null;
  private connected = false;
  private stopped = false;
  private failed = false;
  private readonly digital = new Map<string, boolean>();
  private readonly analog = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly port: string,
    /** Messages for the learner (connected, or why the board cannot be used). */
    private readonly report: (message: string, ok: boolean) => void,
  ) {}

  private ensure(): Promise<boolean> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      if (!this.port) {
        this.fail('The program uses board blocks, but no board is connected. Plug in the board and choose its USB port.');
        return false;
      }
      const r = await window.studio.live.connect(this.port);
      if (this.stopped) {
        if (r.ok) await window.studio.live.disconnect(true);
        return false;
      }
      if (!r.ok) {
        this.fail(r.needsFirmware ? `${r.message} Use Run live in Upload mode once to install the live firmware.` : r.message);
        return false;
      }
      this.connected = true;
      this.report(r.message, true);
      this.timer = setInterval(() => void this.poll(), POLL_MS);
      return true;
    })();
    return this.connecting;
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.report(message, false);
  }

  private send(op: LiveOp): Promise<number | null> {
    return window.studio.live.io(op).then((r) => {
      if ('error' in r) throw new Error(r.error);
      return r.value;
    });
  }

  private write(op: LiveOp): void {
    if (this.stopped || this.failed) return;
    this.queue = this.queue
      .then(async () => {
        if (this.stopped || !(await this.ensure())) return;
        await this.send(op);
      })
      .catch((e: unknown) => this.fail(e instanceof Error ? e.message : String(e)));
  }

  private async poll(): Promise<void> {
    if (this.polling || this.stopped || !this.connected) return;
    this.polling = true;
    try {
      for (const key of [...this.digital.keys()]) {
        const [pin, pullup] = key.split(':');
        const v = await this.send({ op: 'digitalRead', pin: Number(pin), pullup: pullup === '1' });
        this.digital.set(key, v === 1);
      }
      for (const ch of [...this.analog.keys()]) this.analog.set(ch, (await this.send({ op: 'analogRead', channel: ch })) ?? 0);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    } finally {
      this.polling = false;
    }
  }

  digitalWrite(pin: number, on: boolean): void {
    this.write({ op: 'digitalWrite', pin, on });
  }
  analogWrite(pin: number, value: number): void {
    this.write({ op: 'analogWrite', pin, value });
  }
  servoWrite(pin: number, angle: number): void {
    this.write({ op: 'servoWrite', pin, angle });
  }
  digitalRead(pin: number, pullup: boolean): boolean {
    const key = `${pin}:${pullup ? 1 : 0}`;
    if (!this.digital.has(key)) {
      // Until the first reading: a pulled-up input reads HIGH (a button not pressed).
      this.digital.set(key, pullup);
      void this.ensure();
    }
    return this.digital.get(key)!;
  }
  analogRead(channel: number): number {
    if (!this.analog.has(channel)) {
      this.analog.set(channel, 0);
      void this.ensure();
    }
    return this.analog.get(channel)!;
  }

  /** End of the run: stop polling and switch the board's pins off. */
  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.queue.catch(() => undefined);
    if (this.connected) await window.studio.live.disconnect(true).catch(() => undefined);
    this.connected = false;
  }

  /** Whether the program has used the board (for the status line). */
  get inUse(): boolean {
    return this.connecting !== null;
  }
}
