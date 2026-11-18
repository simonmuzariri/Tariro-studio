/**
 * A real DJI Tello behind the `DroneLink` interface, so the same block program flies it. Commands go
 * to the main process (which checks each one with the drone safety guard and talks UDP to the
 * drone); the state comes back from there.
 *
 * The drone reports its height and heading, not where it is: between "ok"s the picture moves the
 * drone towards where the command should take it, then settles on the guard's estimate.
 */
import { planMove, type DroneFlip, type DroneLink, type DroneLinkState, type DroneMove, type DronePhase, type DroneState, type DroneTurn, type PathPoint } from '@tariro-studio/core';

const OPEN = { maxHeight: Infinity, fenceRadius: Infinity };

interface Motion {
  from: { x: number; y: number; z: number; heading: number };
  to: { x: number; y: number; z: number; heading: number };
  started: number;
  seconds: number;
  phase: DronePhase;
}

export class TelloLink implements DroneLink {
  private latest: DroneLinkState | undefined;
  private motion: Motion | undefined;
  private readonly off: () => void;
  readonly path: PathPoint[] = [];
  /** Messages from the main process (a refused command, the watchdog), newest last. */
  readonly notes: string[] = [];

  constructor(private readonly onChange?: (s: DroneLinkState) => void) {
    this.off = window.studio.drone.onState((s) => {
      this.latest = s;
      if (s.message) this.notes.push(s.message);
      this.onChange?.(s);
    });
  }

  dispose(): void {
    this.off();
  }

  get connected(): boolean {
    return !!this.latest?.connected;
  }

  private async send(c: Parameters<typeof window.studio.drone.command>[0], motion?: Omit<Motion, 'from' | 'started'> & { from?: Motion['from'] }): Promise<void> {
    const now = this.pose();
    if (motion) this.motion = { from: motion.from ?? now, to: motion.to, seconds: motion.seconds, phase: motion.phase, started: performance.now() };
    try {
      const r = await window.studio.drone.command(c);
      if ('error' in r) throw new Error(r.error);
    } finally {
      this.motion = undefined;
    }
  }

  private pose(): Motion['from'] {
    const s = this.latest;
    return { x: s?.x ?? 0, y: s?.y ?? 0, z: s?.z ?? 0, heading: s?.heading ?? 0 };
  }

  takeoff(): Promise<void> {
    this.path.length = 0;
    const from = { x: 0, y: 0, z: 0, heading: 0 };
    return this.send({ kind: 'takeoff' }, { from, to: { ...from, z: 80 }, seconds: 3, phase: 'takeoff' });
  }

  land(): Promise<void> {
    const p = this.pose();
    return this.send({ kind: 'land' }, { to: { ...p, z: 0 }, seconds: Math.max(1, p.z / 40), phase: 'landing' });
  }

  move(direction: DroneMove, cm: number): Promise<void> {
    const p = this.pose();
    const plan = planMove(p, direction, cm, OPEN);
    const to = 'to' in plan ? plan.to : p;
    return this.send({ kind: 'move', direction, cm }, { to, seconds: cm / Math.max(this.latest?.speed ?? 10, 10), phase: 'moving' });
  }

  turn(direction: DroneTurn, degrees: number): Promise<void> {
    const p = this.pose();
    // Not normalised, so the picture turns the short way it was told to.
    const heading = p.heading + (direction === 'right' ? degrees : -degrees);
    return this.send({ kind: 'turn', direction, degrees }, { to: { ...p, heading }, seconds: degrees / 90, phase: 'turning' });
  }

  flip(direction: DroneFlip): Promise<void> {
    const p = this.pose();
    return this.send({ kind: 'flip', direction }, { to: p, seconds: 1, phase: 'flipping' });
  }

  setSpeed(cmPerSecond: number): Promise<void> {
    return this.send({ kind: 'speed', cmPerSecond });
  }

  async emergency(): Promise<void> {
    this.motion = undefined;
    await window.studio.drone.emergency();
  }

  state(): DroneState {
    const s = this.latest;
    let p = this.pose();
    let phase: DronePhase = s?.flying ? 'hover' : 'ground';
    const m = this.motion;
    if (m) {
      const k = Math.min(1, (performance.now() - m.started) / 1000 / m.seconds);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      p = {
        x: m.from.x + (m.to.x - m.from.x) * e,
        y: m.from.y + (m.to.y - m.from.y) * e,
        // The drone's own height when it reports one; the plan otherwise.
        z: s?.flying && m.phase !== 'takeoff' && m.phase !== 'landing' ? p.z : m.from.z + (m.to.z - m.from.z) * e,
        heading: (((m.from.heading + (m.to.heading - m.from.heading) * e) % 360) + 360) % 360,
      };
      phase = m.phase;
    }
    const out: DroneState = {
      ...p,
      pitch: s?.pitch ?? 0,
      roll: s?.roll ?? 0,
      battery: s?.battery ?? 0,
      flying: !!s?.flying || m?.phase === 'takeoff',
      speed: s?.speed ?? 10,
      phase,
      flightTime: s?.flightTime ?? 0,
    };
    if (out.flying) {
      const last = this.path.at(-1);
      if (!last || Math.hypot(out.x - last.x, out.y - last.y, out.z - last.z) >= 2) this.path.push({ x: out.x, y: out.y, z: out.z, t: out.flightTime });
    }
    return out;
  }
}
