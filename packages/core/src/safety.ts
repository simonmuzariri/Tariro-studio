/**
 * The execution safety layer (EXPANSION_PLAN A4, Phase 5a). Every command that would move or
 * switch something on a real board (from live mode, Stage mode, Python, and so from any AI
 * decision in those programs) passes through here, in the main process, before it reaches the
 * board. Nothing in the renderer can reach hardware another way.
 *
 * It clamps values to safe ranges, applies the learner's motor speed limit, refuses bad pins and
 * command floods, latches an emergency stop, runs a watchdog, and keeps a log.
 */
import type { LiveOp } from './ipc.js';
import type { BoardDefinition } from './types.js';

export interface SafetySettings {
  /** The fastest motors may run, in percent of full speed (10–100). */
  motorSpeedLimit: number;
}
export const DEFAULT_SAFETY: SafetySettings = { motorSpeedLimit: 100 };

/** Without a heartbeat from the app for this long, the board is switched off. */
export const WATCHDOG_MS = 1500;
/** More commands than this per second is a runaway program, not a learner's robot. */
export const MAX_COMMANDS_PER_SECOND = 600;

export type SafetyOutcome = 'ok' | 'limited' | 'blocked';

export interface SafetyLogEntry {
  at: number;
  op: LiveOp;
  outcome: SafetyOutcome;
  note?: string;
}

export type SafetyVerdict = { allow: true; op: LiveOp; note?: string } | { allow: false; reason: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export class SafetyLayer {
  private settings: SafetySettings = { ...DEFAULT_SAFETY };
  private board: BoardDefinition | undefined;
  private stopped = false;
  private lastBeat = 0;
  private recent: number[] = [];
  readonly log: SafetyLogEntry[] = [];
  private static readonly LOG_SIZE = 300;

  configure(board: BoardDefinition | undefined, settings: Partial<SafetySettings> = {}): void {
    this.board = board;
    this.settings = { ...this.settings, ...settings, motorSpeedLimit: clamp(Math.round(settings.motorSpeedLimit ?? this.settings.motorSpeedLimit), 10, 100) };
  }

  get current(): SafetySettings {
    return { ...this.settings };
  }

  // ───────── emergency stop ─────────

  /** Latch the emergency stop: every command is refused until reset(). */
  emergencyStop(): void {
    this.stopped = true;
  }
  reset(): void {
    this.stopped = false;
  }
  get emergencyStopped(): boolean {
    return this.stopped;
  }

  // ───────── watchdog ─────────

  heartbeat(now: number): void {
    this.lastBeat = now;
  }
  /** True when the app has been silent too long (checked only while a board is connected). */
  watchdogExpired(now: number): boolean {
    return now - this.lastBeat > WATCHDOG_MS;
  }

  // ───────── the check ─────────

  /** The PWM pins of the onboard motor driver (their duty is motor speed). */
  private motorSpeedPins(): Set<number> {
    const driver = this.board?.onboard?.find((p) => p.kind === 'dual-motor-driver');
    if (!driver) return new Set();
    return new Set(Object.entries(driver.pins).filter(([k]) => /^(EN|PWM)[AB]$/.test(k)).map(([, v]) => v));
  }

  private validPin(pin: number): boolean {
    // Digital pins, plus the analog pins used as digital ones (numbered after them on AVR boards).
    if (!Number.isInteger(pin) || pin < 0) return false;
    if (!this.board) return pin < 128;
    const top = Math.max(...this.board.pins.digital) + this.board.pins.analog.length + 1;
    return pin <= top;
  }

  check(op: LiveOp, now: number): SafetyVerdict {
    const verdict = this.decide(op, now);
    const entry: SafetyLogEntry = verdict.allow
      ? { at: now, op: verdict.op, outcome: verdict.note ? 'limited' : 'ok', ...(verdict.note ? { note: verdict.note } : {}) }
      : { at: now, op, outcome: 'blocked', note: verdict.reason };
    this.log.push(entry);
    if (this.log.length > SafetyLayer.LOG_SIZE) this.log.splice(0, this.log.length - SafetyLayer.LOG_SIZE);
    return verdict;
  }

  private decide(op: LiveOp, now: number): SafetyVerdict {
    if (this.stopped) return { allow: false, reason: 'The emergency stop is on. Press Reset to drive the board again.' };
    const reads = op.op === 'digitalRead' || op.op === 'analogRead' || op.op === 'analogPin';
    if (!reads) {
      this.recent = this.recent.filter((t) => now - t < 1000);
      if (this.recent.length >= MAX_COMMANDS_PER_SECOND)
        return { allow: false, reason: `More than ${MAX_COMMANDS_PER_SECOND} commands a second: the program may be stuck in a loop without a wait.` };
      this.recent.push(now);
    }
    switch (op.op) {
      case 'digitalWrite':
      case 'digitalRead':
        return this.validPin(op.pin) ? { allow: true, op } : { allow: false, reason: `Pin ${op.pin} is not a pin on ${this.board?.name ?? 'this board'}.` };
      case 'analogRead':
      case 'analogPin':
        return op.channel < (this.board?.pins.analog.length ?? 16) ? { allow: true, op } : { allow: false, reason: `A${op.channel} is not an analog pin on ${this.board?.name ?? 'this board'}.` };
      case 'servoWrite': {
        if (!this.validPin(op.pin)) return { allow: false, reason: `Pin ${op.pin} is not a pin on ${this.board?.name ?? 'this board'}.` };
        const angle = clamp(Math.round(op.angle), 0, 180);
        return angle === op.angle ? { allow: true, op } : { allow: true, op: { ...op, angle }, note: `Servo angle ${op.angle} is outside 0–180°; ${angle}° was used.` };
      }
      case 'analogWrite': {
        if (!this.validPin(op.pin)) return { allow: false, reason: `Pin ${op.pin} is not a pin on ${this.board?.name ?? 'this board'}.` };
        let value = clamp(Math.round(op.value), 0, 255);
        let note = value !== op.value ? `PWM ${op.value} is outside 0–255; ${value} was used.` : undefined;
        const limit = this.settings.motorSpeedLimit;
        if (limit < 100 && this.motorSpeedPins().has(op.pin)) {
          const cap = Math.floor((255 * limit) / 100);
          if (value > cap) {
            value = cap;
            note = `Motor speed limited to ${limit} % by the safety settings.`;
          }
        }
        return note ? { allow: true, op: { ...op, value }, note } : { allow: true, op };
      }
    }
  }
}
