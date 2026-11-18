/**
 * Drone Studio (Phase 6a): a simulated quadcopter that takes the same commands as a DJI Tello
 * (SDK 2.0: takeoff, land, up/down/left/right/forward/back 20–500 cm, cw/ccw 1–360°, flips, speed
 * 10–100 cm/s, emergency), so a drone program can later fly a real one (6b).
 *
 * Time is advanced by `step(ms)`: the app calls it every frame, the tests in a loop. A command's
 * promise settles when the drone has finished it, so a block program waits for each move, as it
 * would with a real drone.
 *
 * Safety: the learner's limits (a height ceiling and a fence around the take-off spot) are checked
 * before every move, and a move that would break one is refused with the reason. Take-off needs
 * 10 % battery and flips 50 %; below 5 % in the air the drone lands by itself. The emergency stop
 * cuts the motors at once, as on a Tello: the drone falls.
 *
 * Coordinates are centimetres from the take-off spot: x to the right, y forwards (the way the drone
 * faced at take-off), z up. Heading is in degrees clockwise seen from above, 0 = forwards.
 */

export type DroneMove = 'up' | 'down' | 'left' | 'right' | 'forward' | 'back';
export type DroneTurn = 'left' | 'right';
export type DroneFlip = 'forward' | 'back' | 'left' | 'right';
export type DronePhase = 'ground' | 'takeoff' | 'hover' | 'moving' | 'turning' | 'flipping' | 'landing' | 'falling';

export interface DroneLimits {
  /** Highest the drone may fly, cm. */
  maxHeight: number;
  /** Furthest it may fly from the take-off spot, measured flat along the ground, cm. */
  fenceRadius: number;
}
export const DEFAULT_DRONE_LIMITS: DroneLimits = { maxHeight: 200, fenceRadius: 300 };
/** What the learner may set the limits to. */
export const DRONE_LIMIT_RANGES = { maxHeight: [50, 1000], fenceRadius: [100, 2000] } as const;

export interface DroneState {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Tilt for the picture: forwards (+) / backwards, and to the right (+) / left, degrees. */
  pitch: number;
  roll: number;
  /** Battery, percent. */
  battery: number;
  flying: boolean;
  /** Speed for moves, cm/s. */
  speed: number;
  phase: DronePhase;
  /** Seconds in the air since take-off. */
  flightTime: number;
}

/** What a program can ask of a drone: the simulator, or (Phase 6b) a real Tello. */
export interface DroneLink {
  takeoff(): Promise<void>;
  land(): Promise<void>;
  move(direction: DroneMove, cm: number): Promise<void>;
  turn(direction: DroneTurn, degrees: number): Promise<void>;
  flip(direction: DroneFlip): Promise<void>;
  setSpeed(cmPerSecond: number): Promise<void>;
  /** Cut the motors at once. */
  emergency(): Promise<void>;
  state(): DroneState;
}

/** A point of the flight path, with the time it was flown (seconds from take-off). */
export interface PathPoint {
  x: number;
  y: number;
  z: number;
  t: number;
}

const TAKEOFF_HEIGHT = 80;
const CLIMB = 60; // cm/s for take-off
const DESCEND = 40; // cm/s for landing
const TURN_RATE = 90; // °/s
const FLIP_SECONDS = 1;
const LOWEST = 20; // the lowest a Tello will hover, cm
const GRAVITY = 981; // cm/s²
const DRAIN_SECONDS_PER_PERCENT = 7;

interface Action {
  update(dt: number): boolean; // true when finished
  done(): void;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const round1 = (v: number) => Math.round(v * 10) / 10;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class DroneSim implements DroneLink {
  private s: DroneState;
  private action: Action | undefined;
  private limits: DroneLimits;
  private sinceDrain = 0;
  private fallSpeed = 0;
  readonly path: PathPoint[] = [];
  /** Messages the learner should see (an automatic landing), newest last. */
  readonly notes: string[] = [];

  constructor(limits: Partial<DroneLimits> = {}, battery = 100) {
    this.limits = { ...DEFAULT_DRONE_LIMITS, ...limits };
    this.s = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, battery, flying: false, speed: 50, phase: 'ground', flightTime: 0 };
  }

  state(): DroneState {
    return { ...this.s };
  }

  get currentLimits(): DroneLimits {
    return { ...this.limits };
  }

  setLimits(limits: Partial<DroneLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  /** Back on the ground at the take-off spot, a fresh flight (the battery stays as it is). */
  reset(): void {
    this.cancel();
    this.s = { ...this.s, x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, flying: false, phase: 'ground', flightTime: 0 };
    this.path.length = 0;
    this.fallSpeed = 0;
  }

  /** End the command in progress where the drone is (the program was stopped): it hovers there. */
  cancel(): void {
    const a = this.action;
    this.action = undefined;
    if (this.s.phase !== 'falling' && this.s.phase !== 'ground') this.s.phase = this.s.flying ? 'hover' : 'ground';
    this.s.pitch = this.s.roll = 0;
    a?.done();
  }

  // ───────── commands ─────────

  takeoff(): Promise<void> {
    if (this.s.flying) return Promise.reject(new Error('The drone is already flying.'));
    if (this.s.battery < 10) return Promise.reject(new Error(`The battery is at ${Math.round(this.s.battery)} %: charge it before flying (take-off needs 10 %).`));
    const target = Math.min(TAKEOFF_HEIGHT, this.limits.maxHeight);
    this.s.flying = true;
    this.s.flightTime = 0;
    this.path.length = 0;
    this.record(true);
    return this.start('takeoff', (dt) => {
      this.s.z = Math.min(target, this.s.z + CLIMB * dt);
      return this.s.z >= target;
    });
  }

  land(): Promise<void> {
    if (!this.s.flying) return Promise.reject(new Error('The drone is not flying.'));
    return this.landing();
  }

  move(direction: DroneMove, cm: number): Promise<void> {
    const problem = this.mustFly() ?? (cm < 20 || cm > 500 ? `Move between 20 and 500 cm at a time (not ${round1(cm)} cm).` : undefined);
    if (problem) return Promise.reject(new Error(problem));
    const h = rad(this.s.heading);
    const fwd = { x: Math.sin(h), y: Math.cos(h) };
    const right = { x: Math.cos(h), y: -Math.sin(h) };
    const d = { x: 0, y: 0, z: 0 };
    if (direction === 'up') d.z = cm;
    else if (direction === 'down') d.z = -cm;
    else {
      const v = direction === 'forward' ? fwd : direction === 'back' ? { x: -fwd.x, y: -fwd.y } : direction === 'right' ? right : { x: -right.x, y: -right.y };
      d.x = v.x * cm;
      d.y = v.y * cm;
    }
    const from = { x: this.s.x, y: this.s.y, z: this.s.z };
    const to = { x: from.x + d.x, y: from.y + d.y, z: from.z + d.z };
    const limit = this.breaks(to);
    if (limit) return Promise.reject(new Error(limit));
    const seconds = cm / this.s.speed;
    let t = 0;
    // Tilt into the move, as a quadcopter leans the way it flies.
    const lean = Math.min(12, 4 + this.s.speed / 10);
    const pitch = direction === 'forward' ? lean : direction === 'back' ? -lean : 0;
    const roll = direction === 'right' ? lean : direction === 'left' ? -lean : 0;
    return this.start('moving', (dt) => {
      t = Math.min(1, t + dt / seconds);
      const k = ease(t);
      this.s.x = from.x + d.x * k;
      this.s.y = from.y + d.y * k;
      this.s.z = from.z + d.z * k;
      const tilt = Math.sin(Math.PI * t);
      this.s.pitch = pitch * tilt;
      this.s.roll = roll * tilt;
      return t >= 1;
    });
  }

  turn(direction: DroneTurn, degrees: number): Promise<void> {
    const problem = this.mustFly() ?? (degrees < 1 || degrees > 360 ? `Turn between 1° and 360° at a time (not ${round1(degrees)}°).` : undefined);
    if (problem) return Promise.reject(new Error(problem));
    const from = this.s.heading;
    const delta = direction === 'right' ? degrees : -degrees;
    const seconds = degrees / TURN_RATE;
    let t = 0;
    return this.start('turning', (dt) => {
      t = Math.min(1, t + dt / seconds);
      this.s.heading = (((from + delta * ease(t)) % 360) + 360) % 360;
      return t >= 1;
    });
  }

  flip(direction: DroneFlip): Promise<void> {
    const problem =
      this.mustFly() ??
      (this.s.battery < 50 ? `Flips need 50 % battery (it is at ${Math.round(this.s.battery)} %).` : this.s.z < 60 ? 'Fly higher before a flip: it needs at least 60 cm.' : undefined);
    if (problem) return Promise.reject(new Error(problem));
    let t = 0;
    return this.start('flipping', (dt) => {
      t = Math.min(1, t + dt / FLIP_SECONDS);
      const turn = 360 * ease(t);
      if (direction === 'forward' || direction === 'back') this.s.pitch = direction === 'forward' ? turn : -turn;
      else this.s.roll = direction === 'right' ? turn : -turn;
      // A flip loses a little height and climbs back.
      if (t >= 1) this.s.pitch = this.s.roll = 0;
      return t >= 1;
    });
  }

  setSpeed(cmPerSecond: number): Promise<void> {
    if (cmPerSecond < 10 || cmPerSecond > 100) return Promise.reject(new Error(`Set a speed between 10 and 100 cm/s (not ${round1(cmPerSecond)}).`));
    this.s.speed = cmPerSecond;
    return Promise.resolve();
  }

  emergency(): Promise<void> {
    this.cancel();
    if (this.s.flying) {
      this.s.phase = 'falling';
      this.fallSpeed = 0;
      this.notes.push('Emergency stop: the motors are off and the drone fell.');
    }
    return Promise.resolve();
  }

  // ───────── time ─────────

  /** Advance the simulation by `ms` milliseconds. */
  step(ms: number): void {
    const dt = Math.max(0, ms) / 1000;
    if (this.s.phase === 'falling') {
      this.fallSpeed += GRAVITY * dt;
      this.s.z = Math.max(0, this.s.z - this.fallSpeed * dt);
      this.s.roll = Math.min(25, this.s.roll + 40 * dt);
      if (this.s.z === 0) {
        this.s.flying = false;
        this.s.phase = 'ground';
        this.s.roll = 0;
      }
      this.record();
      return;
    }
    if (!this.s.flying) return;
    this.s.flightTime += dt;
    this.sinceDrain += dt;
    while (this.sinceDrain >= DRAIN_SECONDS_PER_PERCENT) {
      this.sinceDrain -= DRAIN_SECONDS_PER_PERCENT;
      this.s.battery = Math.max(0, this.s.battery - 1);
    }
    if (this.s.battery < 5 && this.s.phase !== 'landing') {
      this.notes.push(`The battery is at ${Math.round(this.s.battery)} %: the drone is landing by itself.`);
      this.cancel();
      void this.landing();
    }
    const a = this.action;
    if (a && a.update(dt)) {
      this.action = undefined;
      if (this.s.flying) this.s.phase = 'hover';
      a.done();
    }
    this.record();
  }

  // ───────── helpers ─────────

  private landing(): Promise<void> {
    return this.start('landing', (dt) => {
      this.s.z = Math.max(0, this.s.z - DESCEND * dt);
      if (this.s.z > 0) return false;
      this.s.flying = false;
      this.s.phase = 'ground';
      return true;
    });
  }

  private mustFly(): string | undefined {
    return this.s.flying && this.s.phase !== 'falling' && this.s.phase !== 'landing' ? undefined : 'Take off first: the drone is on the ground.';
  }

  /** Why the drone may not fly to this point, or undefined if it may. */
  private breaks(p: { x: number; y: number; z: number }): string | undefined {
    if (p.z > this.limits.maxHeight) return `That would take the drone to ${Math.round(p.z)} cm, above its ${this.limits.maxHeight} cm height limit.`;
    if (p.z < LOWEST) return `The drone cannot fly lower than ${LOWEST} cm; use "land" to come down.`;
    const away = Math.hypot(p.x, p.y);
    if (away > this.limits.fenceRadius) return `That would take the drone ${Math.round(away)} cm from the take-off spot, outside its ${this.limits.fenceRadius} cm fence.`;
    return undefined;
  }

  /** Run one command; a new command waits for the one in progress (a block program sends one at a time). */
  private start(phase: DronePhase, update: (dt: number) => boolean): Promise<void> {
    this.cancel();
    this.s.phase = phase;
    return new Promise<void>((resolve) => {
      this.action = { update, done: resolve };
    });
  }

  private record(force = false): void {
    const last = this.path.at(-1);
    const p = { x: round1(this.s.x), y: round1(this.s.y), z: round1(this.s.z), t: Math.round(this.s.flightTime * 100) / 100 };
    if (force || !last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) >= 2) this.path.push(p);
    if (this.path.length > 5000) this.path.splice(0, this.path.length - 5000);
  }
}
