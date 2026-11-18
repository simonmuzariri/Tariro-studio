/**
 * The DJI Tello's text protocol (SDK 2.0) and the safety guard every command to a real drone passes
 * through (Phase 6b). Pure TypeScript: the main process owns the UDP sockets and uses these.
 *
 * Protocol: commands go as text to the drone (192.168.10.1:8889) and it answers "ok" or "error …"
 * when the command is done; "command" first switches it into SDK mode. It broadcasts its state ten
 * times a second to port 8890 as "pitch:0;roll:0;yaw:0;…;h:0;bat:87;…". Without a command for 15 s it
 * lands by itself.
 *
 * The guard: the Tello reports its height, heading and battery but not where it is, so the guard
 * keeps an estimate from the moves it accepted (the same planning as the simulator), corrected by the
 * height and heading the drone reports. It refuses what breaks the learner's limits or the battery
 * rules, and the main process lands the drone when the app goes quiet (watchdog) or it climbs too
 * high.
 */
import { z } from 'zod';
import { checkFlip, checkSpeed, checkTakeoff, DEFAULT_DRONE_LIMITS, planMove, planTurn, takeoffHeight, type DroneLimits, type DronePose } from './sim.js';

export const TELLO_ADDRESS = { host: '192.168.10.1', port: 8889 } as const;
export const TELLO_STATE_PORT = 8890;
/** Without a heartbeat from the app for this long, a flying drone is told to land. */
export const DRONE_WATCHDOG_MS = 1500;
/** The Tello lands by itself after 15 s without a command: keep it awake well before that. */
export const TELLO_KEEPALIVE_MS = 5000;

const Move = z.enum(['up', 'down', 'left', 'right', 'forward', 'back']);
/** A command for a real drone, as the renderer sends it to the main process. */
export const DroneCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('takeoff') }),
  z.object({ kind: z.literal('land') }),
  z.object({ kind: z.literal('move'), direction: Move, cm: z.number() }),
  z.object({ kind: z.literal('turn'), direction: z.enum(['left', 'right']), degrees: z.number() }),
  z.object({ kind: z.literal('flip'), direction: z.enum(['forward', 'back', 'left', 'right']) }),
  z.object({ kind: z.literal('speed'), cmPerSecond: z.number() }),
]);
export type DroneCommand = z.infer<typeof DroneCommandSchema>;

/** The Tello's text for a command (distances and angles rounded to whole numbers, as it wants). */
export function telloText(c: DroneCommand): string {
  switch (c.kind) {
    case 'takeoff':
      return 'takeoff';
    case 'land':
      return 'land';
    case 'move':
      return `${c.direction} ${Math.round(c.cm)}`;
    case 'turn':
      return `${c.direction === 'right' ? 'cw' : 'ccw'} ${Math.round(c.degrees)}`;
    case 'flip':
      return `flip ${c.direction[0]}`;
    case 'speed':
      return `speed ${Math.round(c.cmPerSecond)}`;
  }
}

/** How long to wait for the drone to finish a command and answer. */
export function telloTimeoutMs(c: DroneCommand, speed: number): number {
  switch (c.kind) {
    case 'takeoff':
    case 'land':
      return 20_000;
    case 'move':
      return 8000 + (c.cm / Math.max(speed, 10)) * 1500;
    case 'turn':
      return 8000 + (c.degrees / 90) * 2000;
    case 'flip':
      return 10_000;
    case 'speed':
      return 3000;
  }
}

export interface TelloTelemetry {
  pitch: number;
  roll: number;
  /** −180…180 °, clockwise positive, from where it was switched on. */
  yaw: number;
  /** Height above the take-off point, cm. */
  h: number;
  /** Distance sensor under the drone, cm. */
  tof: number;
  bat: number;
  /** Seconds the motors have run. */
  time: number;
}

/** "pitch:0;roll:0;yaw:12;…;h:80;bat:87;…" → the readings, or undefined if it is not a state packet. */
export function parseTelloState(text: string): TelloTelemetry | undefined {
  const fields = new Map<string, number>();
  for (const part of text.trim().split(';')) {
    const m = /^([a-z]+):(-?\d+(?:\.\d+)?)$/.exec(part.trim());
    if (m) fields.set(m[1]!, Number(m[2]));
  }
  if (!fields.has('bat') || !fields.has('h')) return undefined;
  const f = (k: string) => fields.get(k) ?? 0;
  return { pitch: f('pitch'), roll: f('roll'), yaw: f('yaw'), h: f('h'), tof: f('tof'), bat: f('bat'), time: f('time') };
}

/** The drone's state as Drone Studio shows it (the main process sends it to the window). */
export const DroneLinkStateSchema = z.object({
  connected: z.boolean(),
  flying: z.boolean(),
  /** Estimated from the moves made, corrected by the drone's own height and heading. */
  x: z.number(),
  y: z.number(),
  z: z.number(),
  heading: z.number(),
  pitch: z.number(),
  roll: z.number(),
  battery: z.number(),
  speed: z.number(),
  /** Seconds of motor time this flight. */
  flightTime: z.number(),
  /** The command being flown, if any ("forward 100"). */
  busy: z.string().optional(),
  /** Something the learner should know (a refused command, the watchdog landing it). */
  message: z.string().max(500).optional(),
});
export type DroneLinkState = z.infer<typeof DroneLinkStateSchema>;

const norm = (deg: number) => ((deg % 360) + 360) % 360;
/** The guard lands the drone if it reports being this far above the height limit. */
const HEIGHT_MARGIN = 30;

export type GuardVerdict = { allow: true } | { allow: false; reason: string };

/** Keeps a real drone inside the learner's limits. One per connection. */
export class DroneGuard {
  private limits: DroneLimits = { ...DEFAULT_DRONE_LIMITS };
  private pose: DronePose = { x: 0, y: 0, z: 0, heading: 0 };
  private yawAtTakeoff: number | undefined;
  private lastBeat = 0;
  flying = false;
  battery = 100;
  speed = 10; // a Tello starts at 10 cm/s until told otherwise
  telemetry: TelloTelemetry | undefined;
  readonly log: Array<{ at: number; command: string; outcome: 'sent' | 'refused'; note?: string }> = [];

  setLimits(limits: Partial<DroneLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }
  get currentLimits(): DroneLimits {
    return { ...this.limits };
  }

  /** May this command go to the drone? Records the decision. */
  check(c: DroneCommand, now = Date.now()): GuardVerdict {
    const verdict = this.decide(c);
    this.log.push({ at: now, command: telloText(c), outcome: verdict.allow ? 'sent' : 'refused', ...(verdict.allow ? {} : { note: verdict.reason }) });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    return verdict;
  }

  private decide(c: DroneCommand): GuardVerdict {
    const no = (reason: string): GuardVerdict => ({ allow: false, reason });
    if (c.kind === 'takeoff') {
      if (this.flying) return no('The drone is already flying.');
      const low = checkTakeoff(this.battery);
      return low ? no(low) : { allow: true };
    }
    if (c.kind === 'speed') {
      const bad = checkSpeed(c.cmPerSecond);
      return bad ? no(bad) : { allow: true };
    }
    if (!this.flying) return no('Take off first: the drone is on the ground.');
    if (c.kind === 'land') return { allow: true };
    if (c.kind === 'move') {
      const plan = planMove(this.pose, c.direction, c.cm, this.limits);
      return 'error' in plan ? no(plan.error) : { allow: true };
    }
    if (c.kind === 'turn') {
      const plan = planTurn(this.pose.heading, c.direction, c.degrees);
      return 'error' in plan ? no(plan.error) : { allow: true };
    }
    const flip = checkFlip(this.battery, this.pose.z);
    return flip ? no(flip) : { allow: true };
  }

  /** The drone answered "ok": update the estimate as if the command was flown exactly. */
  done(c: DroneCommand): void {
    switch (c.kind) {
      case 'takeoff':
        this.flying = true;
        this.pose = { x: 0, y: 0, z: takeoffHeight(this.limits), heading: 0 };
        this.yawAtTakeoff = this.telemetry?.yaw;
        break;
      case 'land':
        this.flying = false;
        this.pose.z = 0;
        break;
      case 'move': {
        const plan = planMove(this.pose, c.direction, c.cm, { maxHeight: Infinity, fenceRadius: Infinity });
        if ('to' in plan) this.pose = plan.to;
        break;
      }
      case 'turn': {
        const plan = planTurn(this.pose.heading, c.direction, c.degrees);
        if ('heading' in plan) this.pose.heading = plan.heading;
        break;
      }
      case 'speed':
        this.speed = c.cmPerSecond;
        break;
      case 'flip':
        break;
    }
  }

  /** The motors were cut (emergency): it is no longer flying. */
  stopped(): void {
    this.flying = false;
    this.pose.z = 0;
  }

  /**
   * A state packet from the drone: the height and heading it reports replace the estimate. Returns a
   * reason to land at once when it is well above the height limit (a gust, a wrong estimate).
   */
  report(t: TelloTelemetry): string | undefined {
    this.telemetry = t;
    this.battery = t.bat;
    if (!this.flying) return undefined;
    this.pose.z = t.h;
    if (this.yawAtTakeoff !== undefined) this.pose.heading = norm(t.yaw - this.yawAtTakeoff);
    if (t.h > this.limits.maxHeight + HEIGHT_MARGIN) return `The drone is at ${t.h} cm, above its ${this.limits.maxHeight} cm height limit: landing.`;
    return undefined;
  }

  // ───────── watchdog ─────────
  heartbeat(now = Date.now()): void {
    this.lastBeat = now;
  }
  watchdogExpired(now = Date.now()): boolean {
    return now - this.lastBeat > DRONE_WATCHDOG_MS;
  }

  state(connected: boolean, extra: { busy?: string; message?: string } = {}): DroneLinkState {
    const t = this.telemetry;
    return {
      connected,
      flying: this.flying,
      x: Math.round(this.pose.x * 10) / 10,
      y: Math.round(this.pose.y * 10) / 10,
      z: this.flying ? (t?.h ?? this.pose.z) : 0,
      heading: this.pose.heading,
      pitch: t?.pitch ?? 0,
      roll: t?.roll ?? 0,
      battery: this.battery,
      speed: this.speed,
      flightTime: t?.time ?? 0,
      ...(extra.busy ? { busy: extra.busy } : {}),
      ...(extra.message ? { message: extra.message } : {}),
    };
  }
}
