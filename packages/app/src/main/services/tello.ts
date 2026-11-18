/**
 * The link to a real DJI Tello (Phase 6b), in the main process: UDP text commands to the drone and
 * its state broadcast back. Every command passes the `DroneGuard` first, so nothing in the window
 * (a block program, an AI decision) can fly the drone outside the learner's limits.
 *
 * One command is in flight at a time (the Tello answers "ok" when it has finished). "Land now" and
 * the emergency stop do not wait: they cancel the command in progress. The drone is kept awake while
 * idle (it lands by itself after 15 s without a command), and told to land if the app stops sending
 * heartbeats or the drone climbs well above the height limit.
 */
import dgram from 'node:dgram';
import { DroneGuard, parseTelloState, TELLO_ADDRESS, TELLO_KEEPALIVE_MS, TELLO_STATE_PORT, telloText, telloTimeoutMs, type DroneCommand, type DroneLimits, type DroneLinkState } from '@tariro-studio/core';

export interface TelloEndpoint {
  host: string;
  port: number;
  statePort: number;
}
export const REAL_TELLO: TelloEndpoint = { host: TELLO_ADDRESS.host, port: TELLO_ADDRESS.port, statePort: TELLO_STATE_PORT };

interface Pending {
  resolve(reply: string): void;
  timer: NodeJS.Timeout;
}

export class TelloService {
  private cmd: dgram.Socket | undefined;
  private stateSocket: dgram.Socket | undefined;
  private guard = new DroneGuard();
  private limits: DroneLimits | undefined;
  private pending: Pending | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSent = 0;
  private lastEmit = 0;
  private busy: string | undefined;
  private keepAlive: NodeJS.Timeout | undefined;
  private landingForSafety = false;
  connected = false;

  constructor(
    private readonly endpoint: TelloEndpoint,
    private readonly emit: (s: DroneLinkState) => void,
  ) {}

  async connect(): Promise<{ ok: boolean; message: string }> {
    if (this.connected) return { ok: true, message: 'Connected to the drone.' };
    try {
      await this.open();
    } catch (e) {
      this.close();
      return { ok: false, message: `The drone link could not start: ${e instanceof Error ? e.message : String(e)}` };
    }
    // Two tries: the first packet after joining the drone's Wi-Fi is sometimes lost.
    let reply = await this.request('command', 3000);
    if (reply !== 'ok') reply = await this.request('command', 3000);
    if (reply !== 'ok') {
      this.close();
      return { ok: false, message: 'No drone answered. Switch the Tello on, join its Wi-Fi network (TELLO-…) on this computer, and try again.' };
    }
    this.connected = true;
    this.guard = new DroneGuard();
    if (this.limits) this.guard.setLimits(this.limits);
    this.guard.heartbeat();
    this.keepAlive = setInterval(() => {
      if (!this.pending && Date.now() - this.lastSent > TELLO_KEEPALIVE_MS) void this.enqueue(() => this.request('command', 3000));
    }, 1000);
    this.keepAlive.unref();
    this.publish('Connected to the drone.');
    return { ok: true, message: 'Connected to the drone.' };
  }

  async disconnect(): Promise<boolean> {
    if (!this.connected) return false;
    if (this.guard.flying) await this.landNow('Landing before disconnecting.');
    this.close();
    this.publish();
    return true;
  }

  setLimits(limits: DroneLimits): void {
    this.limits = limits;
    this.guard.setLimits(limits);
  }

  heartbeat(): void {
    this.guard.heartbeat();
  }

  /** One command through the guard; resolves when the drone has done it (or refused, or not answered). */
  command(c: DroneCommand): Promise<{ ok: true } | { error: string }> {
    return this.enqueue(async () => {
      if (!this.connected) return { error: 'The drone is not connected.' };
      const verdict = this.guard.check(c);
      if (!verdict.allow) {
        this.publish(verdict.reason);
        return { error: verdict.reason };
      }
      const text = telloText(c);
      this.busy = text;
      this.publish();
      const reply = await this.request(text, telloTimeoutMs(c, this.guard.speed));
      this.busy = undefined;
      if (reply === 'ok') {
        this.guard.done(c);
        this.publish();
        return { ok: true as const };
      }
      const error = reply === 'stopped' ? 'Stopped.' : reply === 'timeout' ? `The drone did not finish "${text}" in time. Check that it is in sight and in the air.` : `The drone said: ${reply}`;
      this.publish(error);
      return { error };
    });
  }

  /** Stop what it is doing and land where it is. */
  async landNow(message = 'Landing.'): Promise<boolean> {
    if (!this.connected || !this.guard.flying) return false;
    this.cancelPending();
    // "stop" makes a Tello hover at once (SDK 2.0); its answers and the cancelled command's are let go.
    this.raw('stop');
    await new Promise((r) => setTimeout(r, 400));
    this.publish(message);
    const reply = await this.enqueue(() => this.request('land', 20_000));
    if (reply === 'ok') this.guard.done({ kind: 'land' });
    this.publish();
    return reply === 'ok';
  }

  /** Cut the motors: the drone falls. Only to prevent harm. */
  emergency(): boolean {
    if (!this.connected) return false;
    this.cancelPending();
    this.raw('emergency');
    this.guard.stopped();
    this.publish('Emergency stop: the motors are off.');
    return true;
  }

  /** Called every 250 ms: land a flying drone if the app has gone quiet. */
  checkWatchdog(): void {
    if (!this.connected || !this.guard.flying || this.landingForSafety || !this.guard.watchdogExpired()) return;
    this.landingForSafety = true;
    void this.landNow('The app stopped answering: the drone is landing.').finally(() => (this.landingForSafety = false));
  }

  // ───────── UDP ─────────

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = dgram.createSocket('udp4');
      const state = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      cmd.on('message', (msg) => this.onReply(msg.toString('utf8').trim()));
      state.on('message', (msg) => this.onState(msg.toString('utf8')));
      cmd.once('error', reject);
      state.once('error', reject);
      cmd.bind(0, () => {
        state.bind(this.endpoint.statePort, () => {
          this.cmd = cmd;
          this.stateSocket = state;
          resolve();
        });
      });
    });
  }

  private close(): void {
    this.cancelPending();
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    for (const s of [this.cmd, this.stateSocket]) {
      try {
        s?.close();
      } catch {
        /* already closed */
      }
    }
    this.cmd = this.stateSocket = undefined;
    this.connected = false;
    this.guard.flying = false;
  }

  private raw(text: string): void {
    this.lastSent = Date.now();
    this.cmd?.send(text, this.endpoint.port, this.endpoint.host);
  }

  /** Send one text and wait for the answer: "ok", "error …", "timeout" or "stopped". */
  private request(text: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        resolve('timeout');
      }, timeoutMs);
      this.pending = { resolve, timer };
      this.raw(text);
    });
  }

  private onReply(reply: string): void {
    const p = this.pending;
    if (!p) return; // an answer to a cancelled command, or to "stop"
    this.pending = undefined;
    clearTimeout(p.timer);
    p.resolve(reply);
  }

  private cancelPending(): void {
    const p = this.pending;
    this.pending = undefined;
    if (p) {
      clearTimeout(p.timer);
      p.resolve('stopped');
    }
    this.busy = undefined;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private onState(text: string): void {
    const t = parseTelloState(text);
    if (!t) return;
    const tooHigh = this.guard.report(t);
    if (tooHigh && !this.landingForSafety) {
      this.landingForSafety = true;
      void this.landNow(tooHigh).finally(() => (this.landingForSafety = false));
    }
    if (Date.now() - this.lastEmit > 200) this.publish();
  }

  private publish(message?: string): void {
    this.lastEmit = Date.now();
    this.emit(this.guard.state(this.connected, { ...(this.busy ? { busy: this.busy } : {}), ...(message ? { message } : {}) }));
  }
}
