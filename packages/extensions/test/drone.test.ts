/** Phase 6a: drone programs run through the block interpreter against the simulated drone. */
import { describe, expect, it } from 'vitest';
import { checkLive, DroneSim, FlightLogSchema, FlightRecorder, getBoard, LiveRun, recordingLink, sampleAt, summarizeFlight, type DroneLink, type LiveBoard, type LiveResult, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, DRONE_STARTER, droneToolbox, flightToWorkspace } from '../src/index.js';

const registry = createRegistry();
const board = getBoard('tariro');
const noBoard: LiveBoard = {
  digitalWrite: async () => {},
  analogWrite: async () => {},
  servoWrite: async () => {},
  digitalRead: async () => false,
  analogRead: async () => 0,
  analogPin: async () => undefined,
};

/** Fly a program to the end with a virtual clock: 50 ms of flight per step. */
async function fly(ws: WorkspaceJson, sim = new DroneSim(), maxSeconds = 120, record?: (now: () => number) => { link: DroneLink; tick(): void }): Promise<{ result: LiveResult; sim: DroneSim; printed: string[] }> {
  let now = 0;
  const printed: string[] = [];
  const rec = record?.(() => now / 1000);
  const run = new LiveRun(ws, board, registry, { io: noBoard, drone: rec?.link ?? sim, now: () => now, sleep: () => new Promise((r) => setImmediate(r)), print: (t) => void printed.push(t) }, 'drone');
  let result: LiveResult | undefined;
  const done = run.run().then((r) => (result = r));
  while (!result && now < maxSeconds * 1000) {
    sim.step(50);
    now += 50;
    rec?.tick();
    await new Promise((r) => setImmediate(r));
  }
  await done;
  return { result: result!, sim, printed };
}

let n = 0;
const id = () => `b${++n}`;
const num = (v: number) => ({ shadow: { type: 'math_number', id: id(), fields: { NUM: v } } });
type B = Record<string, unknown>;
const seq = (...bs: B[]): B => {
  for (let i = bs.length - 2; i >= 0; i--) bs[i]!['next'] = { block: bs[i + 1] };
  return bs[0]!;
};
const program = (...body: B[]): WorkspaceJson => ({ blocks: { languageVersion: 0, blocks: [{ type: 'drone_on_start', id: 'start', inputs: body.length ? { DO: { block: seq(...body) } } : {} }] } });
const takeoff = () => ({ type: 'drone_takeoff', id: id() });
const move = (dir: string, cm: number) => ({ type: 'drone_move', id: id(), fields: { DIR: dir }, inputs: { CM: num(cm) } });

describe('the drone simulator', () => {
  it('flies the starter square: up to 80 cm, four 1 m sides, back where it started, and lands', async () => {
    const { result, sim } = await fly(DRONE_STARTER);
    expect(result.outcome).toBe('finished');
    const s = sim.state();
    expect(s.flying).toBe(false);
    expect(Math.hypot(s.x, s.y)).toBeLessThan(1);
    expect(Math.max(...sim.path.map((p) => p.z))).toBeCloseTo(80, 0);
    // A square: forwards 1 m, then right, back and left (turning right at each corner).
    const far = (fx: number, fy: number) => sim.path.some((p) => Math.abs(p.x - fx) < 2 && Math.abs(p.y - fy) < 2);
    expect(far(0, 100) && far(100, 100) && far(100, 0)).toBe(true);
    expect(s.battery).toBeLessThan(100); // flying uses the battery
  });

  it('refuses a move that breaks the height limit or the fence, and says why', async () => {
    const high = await fly(program(takeoff(), move('up', 300)));
    expect(high.result.outcome).toBe('error');
    expect(high.result.message).toMatch(/above its 200 cm height limit/);
    expect(high.sim.state().z).toBeCloseTo(80, 0); // refused: it did not move
    const far = await fly(program(takeoff(), move('forward', 250), move('forward', 100)), new DroneSim({ fenceRadius: 300 }));
    expect(far.result.message).toMatch(/outside its 300 cm fence/);
  });

  it('wants a take-off first, distances of 20–500 cm, and battery for take-off and flips', async () => {
    expect((await fly(program(move('forward', 50)))).result.message).toMatch(/Take off first/);
    expect((await fly(program(takeoff(), move('forward', 5)))).result.message).toMatch(/between 20 and 500 cm/);
    expect((await fly(program(takeoff()), new DroneSim({}, 8))).result.message).toMatch(/charge it before flying/);
    const flip = await fly(program(takeoff(), move('up', 20), { type: 'drone_flip', id: id(), fields: { DIR: 'forward' } }), new DroneSim({}, 40));
    expect(flip.result.message).toMatch(/Flips need 50 % battery/);
  });

  it('turns, reads its sensors, and moves the way it faces', async () => {
    const ws = program(
      takeoff(),
      { type: 'drone_turn', id: id(), fields: { DIR: 'right' }, inputs: { DEG: num(90) } },
      move('forward', 100),
      // The height reading: above 70 cm after take-off, so it climbs another 20 cm.
      {
        type: 'controls_if',
        id: id(),
        inputs: {
          IF0: { block: { type: 'logic_compare', id: id(), fields: { OP: 'GT' }, inputs: { A: { block: { type: 'drone_reading', id: id(), fields: { WHAT: 'height' } } }, B: num(70) } } },
          DO0: { block: move('up', 20) },
        },
      },
    );
    const { result, sim } = await fly(ws);
    expect(result.outcome).toBe('finished');
    // Facing right after the turn, "forward" goes along x.
    expect(sim.state().x).toBeCloseTo(100, 0);
    expect(sim.state().y).toBeCloseTo(0, 0);
    expect(sim.state().heading).toBeCloseTo(90, 0);
    expect(sim.state().z).toBeCloseTo(100, 0);
  });

  it('lands by itself when the battery runs low, and falls on an emergency stop', () => {
    const sim = new DroneSim({}, 12);
    void sim.takeoff();
    for (let i = 0; i < 2000 && sim.state().battery >= 5; i++) sim.step(100);
    for (let i = 0; i < 200; i++) sim.step(100);
    expect(sim.state().flying).toBe(false);
    expect(sim.notes.join(' ')).toMatch(/landing by itself/);

    const fall = new DroneSim();
    void fall.takeoff();
    for (let i = 0; i < 40; i++) fall.step(50);
    void fall.emergency();
    expect(fall.state().phase).toBe('falling');
    for (let i = 0; i < 20; i++) fall.step(50);
    expect(fall.state().z).toBe(0);
    expect(fall.state().flying).toBe(false);
  });

  it('only drone and general blocks belong in a drone program; the toolbox offers them', () => {
    const withLed = program(takeoff(), { type: 'io_digital_write', id: 'led', fields: { PIN: '13', STATE: 'HIGH' } });
    expect(checkLive(withLed, board, registry, 'drone')[0]).toEqual({ blockId: 'led', message: 'This block cannot be used in a drone program.' });
    expect(checkLive(DRONE_STARTER, board, registry, 'drone')).toEqual([]);
    const names = droneToolbox('beginner').map((c) => c.name);
    expect(names.slice(0, 2)).toEqual(['Start', 'Drone']);
    expect(names).toContain('Control');
    // Not offered to any board's Arduino toolbox.
    expect(registry.toolboxFor(board).some((c) => c.id === 'drone')).toBe(false);
  });
});

describe('recording, replaying and flying a flight again (6c)', () => {
  it('records the square, sums it up, replays it, and turns it into blocks that fly the same square', async () => {
    const sim = new DroneSim();
    let recorder: FlightRecorder | undefined;
    const { result } = await fly(DRONE_STARTER, sim, 120, (clock) => {
      recorder = new FlightRecorder('sim', clock);
      return { link: recordingLink(sim, () => recorder), tick: () => recorder!.sample(sim.state()) };
    });
    expect(result.outcome).toBe('finished');
    const log = recorder!.finish('flight-1', 'Square');
    expect(FlightLogSchema.parse(log)).toEqual(log); // it can be saved in the project
    expect(log.commands.map((c) => c.command.kind)).toEqual(['takeoff', 'move', 'turn', 'move', 'turn', 'move', 'turn', 'move', 'turn', 'land']);
    const sum = summarizeFlight(log);
    expect(sum.maxHeight).toBe(80);
    expect(sum.distance).toBeGreaterThan(550); // 80 up, 4 × 100 round, 80 down
    expect(sum.distance).toBeLessThan(600);
    expect(sum.done).toBe(10);
    // Half-way through the first side: 80 cm up, about half a metre forwards.
    const firstMove = log.commands[1]!.t;
    const mid = sampleAt(log, firstMove - 1)!;
    expect(mid.z).toBeCloseTo(80, 0);
    expect(mid.y).toBeGreaterThan(30);
    expect(mid.y).toBeLessThan(70);

    // The mission: the recorded commands as blocks, flown again on a fresh drone.
    const mission = flightToWorkspace(log);
    expect(checkLive(mission, board, registry, 'drone')).toEqual([]);
    const again = await fly(mission);
    expect(again.result.outcome).toBe('finished');
    const a = again.sim.path;
    const far = (fx: number, fy: number) => a.some((p) => Math.abs(p.x - fx) < 2 && Math.abs(p.y - fy) < 2);
    expect(far(0, 100) && far(100, 100) && far(100, 0)).toBe(true);
  });

  it('keeps refused commands in the log, but not in the mission', async () => {
    const sim = new DroneSim();
    let recorder: FlightRecorder | undefined;
    await fly(program(takeoff(), move('up', 300)), sim, 60, (clock) => {
      recorder = new FlightRecorder('sim', clock);
      return { link: recordingLink(sim, () => recorder), tick: () => recorder!.sample(sim.state()) };
    });
    const log = recorder!.finish('flight-2', 'Too high');
    expect(log.commands.at(-1)).toMatchObject({ ok: false, note: expect.stringMatching(/height limit/) });
    const blocks = JSON.stringify(flightToWorkspace(log));
    expect(blocks).toContain('drone_takeoff');
    expect(blocks).not.toContain('"NUM":300');
  });
});
