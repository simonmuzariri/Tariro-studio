/**
 * Phase 6c: flights are recorded, saved with the project, replayed in the 3D view and turned back
 * into a block program (a mission to fly again).
 *
 * A flight log holds samples of the drone's state (about ten a second while it flies) and every
 * command it was given, with whether it was carried out. Recording works the same for the
 * simulator and a real Tello: `recordingLink` wraps any `DroneLink`.
 */
import { z } from 'zod';
import type { DroneFlip, DroneLink, DroneMove, DroneState, DroneTurn } from './sim.js';
import { DroneCommandSchema, type DroneCommand } from './tello.js';

const Num = z.number().finite();
/** Ten minutes at ten samples a second. */
const MAX_SAMPLES = 6000;
export const FlightSampleSchema = z.object({ t: Num, x: Num, y: Num, z: Num, heading: Num, pitch: Num, roll: Num, battery: Num });
export type FlightSample = z.infer<typeof FlightSampleSchema>;

export const FlightLogSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  /** When it was flown (ISO 8601). */
  at: z.string().max(40),
  target: z.enum(['sim', 'tello']),
  samples: z.array(FlightSampleSchema).max(MAX_SAMPLES),
  commands: z.array(z.object({ t: Num, command: DroneCommandSchema, ok: z.boolean(), note: z.string().max(300).optional() })).max(1000),
});
export type FlightLog = z.infer<typeof FlightLogSchema>;
/** Saved flights per project. */
export const MAX_SAVED_FLIGHTS = 10;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Records one flight: call `sample` every frame, `command` for each command, then `finish`. */
export class FlightRecorder {
  private samples: FlightSample[] = [];
  private commands: FlightLog['commands'] = [];
  private lastT = -1;

  constructor(
    private readonly target: 'sim' | 'tello',
    /** Clock in seconds; the flight's time counts from the recorder's start. */
    private readonly clock: () => number,
    private readonly started = clock(),
  ) {}

  private now(): number {
    return Math.round((this.clock() - this.started) * 100) / 100;
  }

  /** Keep the drone's state, at most ten times a second. */
  sample(s: DroneState): void {
    const t = this.now();
    if (t - this.lastT < 0.1 || this.samples.length >= MAX_SAMPLES) return;
    this.lastT = t;
    this.samples.push({ t, x: r1(s.x), y: r1(s.y), z: r1(s.z), heading: r1(s.heading), pitch: r1(s.pitch), roll: r1(s.roll), battery: Math.round(s.battery) });
  }

  command(command: DroneCommand, ok: boolean, note?: string): void {
    if (this.commands.length < 1000) this.commands.push({ t: this.now(), command, ok, ...(note ? { note: note.slice(0, 300) } : {}) });
  }

  get empty(): boolean {
    return this.samples.length < 2;
  }

  finish(id: string, name: string, at = new Date().toISOString()): FlightLog {
    return { id, name, at, target: this.target, samples: this.samples, commands: this.commands };
  }
}

/** A `DroneLink` that tells the recorder about every command and how it went. */
export function recordingLink(link: DroneLink, recorder: () => FlightRecorder | undefined): DroneLink {
  const run = async (command: DroneCommand, go: () => Promise<void>) => {
    try {
      await go();
      recorder()?.command(command, true);
    } catch (e) {
      recorder()?.command(command, false, e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  return {
    takeoff: () => run({ kind: 'takeoff' }, () => link.takeoff()),
    land: () => run({ kind: 'land' }, () => link.land()),
    move: (direction: DroneMove, cm: number) => run({ kind: 'move', direction, cm }, () => link.move(direction, cm)),
    turn: (direction: DroneTurn, degrees: number) => run({ kind: 'turn', direction, degrees }, () => link.turn(direction, degrees)),
    flip: (direction: DroneFlip) => run({ kind: 'flip', direction }, () => link.flip(direction)),
    setSpeed: (cmPerSecond: number) => run({ kind: 'speed', cmPerSecond }, () => link.setSpeed(cmPerSecond)),
    emergency: () => link.emergency(),
    state: () => link.state(),
  };
}

export interface FlightSummary {
  /** Seconds. */
  duration: number;
  /** Length of the path flown, cm. */
  distance: number;
  /** Highest point, cm. */
  maxHeight: number;
  /** Commands carried out, and refused. */
  done: number;
  refused: number;
}

export function summarizeFlight(log: FlightLog): FlightSummary {
  let distance = 0;
  for (let i = 1; i < log.samples.length; i++) {
    const a = log.samples[i - 1]!;
    const b = log.samples[i]!;
    distance += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return {
    duration: log.samples.at(-1)?.t ?? 0,
    distance: Math.round(distance),
    maxHeight: Math.round(Math.max(0, ...log.samples.map((s) => s.z))),
    done: log.commands.filter((c) => c.ok).length,
    refused: log.commands.filter((c) => !c.ok).length,
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** The shorter way round from one heading to another. */
const lerpAngle = (a: number, b: number, k: number) => {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * k) % 360) + 360) % 360;
};

/** The drone as it was `t` seconds into a recorded flight (between samples, in between). */
export function sampleAt(log: FlightLog, t: number): FlightSample | undefined {
  const s = log.samples;
  if (!s.length) return undefined;
  if (t <= s[0]!.t) return s[0];
  if (t >= s.at(-1)!.t) return s.at(-1);
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = s[lo]!;
  const b = s[hi]!;
  const k = (t - a.t) / Math.max(b.t - a.t, 1e-6);
  return {
    t,
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    z: lerp(a.z, b.z, k),
    heading: lerpAngle(a.heading, b.heading, k),
    pitch: lerp(a.pitch, b.pitch, k),
    roll: lerp(a.roll, b.roll, k),
    battery: lerp(a.battery, b.battery, k),
  };
}
