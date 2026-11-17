import { describe, expect, it } from 'vitest';
import { checkLive, CircuitSimulator, getBoard, LiveRun, type BlockJson, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, deriveCircuit, EXAMPLES } from '../src/index.js';
import { block, forever, n, program, wait, workspace } from '../src/build.js';

const registry = createRegistry();
const uno = getBoard('arduino-uno');
const tariro = getBoard('tariro');
const example = (name: string) => EXAMPLES.find((e) => e.name === name)!.workspace;
const tick = () => new Promise<void>((r) => setImmediate(r));

/** Run a program against its derived circuit. Time is virtual, so waits pass instantly. */
function simulate(ws: WorkspaceJson, board = uno) {
  const { circuit, wiring } = deriveCircuit(ws, board);
  const sim = new CircuitSimulator(circuit, board);
  const printed: string[] = [];
  let clock = 0;
  const run = new LiveRun(
    ws,
    board,
    registry,
    {
      io: sim,
      sleep: async (ms) => {
        clock += ms;
        await tick();
      },
      now: () => clock,
      print: (t) => void printed.push(t),
    },
    'simulation',
  );
  return { sim, run, wiring, printed, clock: () => clock };
}
const ledLevel = (sim: CircuitSimulator, id: string) => sim.getState().parts[id]!.level;
const println = (value: BlockJson) => block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: value } });

describe('circuit derived from blocks', () => {
  it('Blink implies one LED with its resistor on pin 13, and says how to wire it', () => {
    const { circuit, wiring } = deriveCircuit(example('blink'), uno);
    expect(circuit.parts.map((p) => p.kind).sort()).toEqual(['led', 'resistor']);
    expect(wiring).toEqual([{ partId: 'led:D13', title: 'Red LED on pin 13', how: "Pin 13 → 220 Ω resistor → long leg of the LED. Short leg → GND. The board's built-in LED is on this pin too." }]);
  });

  it('several blocks on the same pin share one part', () => {
    const ws = workspace([program(block('basic_led', { fields: { PIN: '9', STATE: 'ON' } }), block('basic_led_brightness', { fields: { PIN: '9' }, inputs: { LEVEL: n(40) } }), block('basic_led', { fields: { PIN: '9', STATE: 'OFF' } }))]);
    expect(deriveCircuit(ws, uno).circuit.parts.filter((p) => p.kind === 'led')).toHaveLength(1);
  });

  it('the Tariro motor blocks imply both motors on the confirmed driver pins', () => {
    const motors = deriveCircuit(example('tariro-motors'), tariro).circuit.parts.filter((p) => p.kind === 'motor');
    expect(motors).toEqual([
      { kind: 'motor', id: 'motor:A', label: 'Motor A (left)', direction: 'D4', speed: 'D5' },
      { kind: 'motor', id: 'motor:B', label: 'Motor B (right)', direction: 'D7', speed: 'D6' },
    ]);
  });
});

describe('block programs driving the simulated circuit', () => {
  it('Blink switches the virtual LED on and off through the solver', async () => {
    const { sim, run, clock } = simulate(example('blink'));
    const seen: number[] = [];
    sim.onChange((s) => seen.push(Math.round(s.parts['led:D13']!.milliamps)));
    const done = run.run();
    while (clock() < 4000) await tick();
    run.stop();
    expect((await done).outcome).toBe('stopped');
    // On (about 13 mA through the 220 Ω resistor and the pin's own 25 Ω), off, on, off…
    expect(seen.slice(0, 4)).toEqual([13, 0, 13, 0]);
  });

  it('a button lights an LED: the program reads the solved pin voltage', async () => {
    const ws = workspace([
      program(
        forever(
          block('controls_if', {
            extraState: { hasElse: true },
            inputs: { IF0: block('sensor_button_pressed', { fields: { PIN: '2' } }) },
            do: { DO0: [block('basic_led', { fields: { PIN: '9', STATE: 'ON' } })], ELSE: [block('basic_led', { fields: { PIN: '9', STATE: 'OFF' } })] },
          }),
          block('tariro_wait_ms', { inputs: { MS: n(20) } }),
        ),
      ),
    ]);
    const { sim, run, clock } = simulate(ws);
    const done = run.run();
    const settle = async () => {
      const until = clock() + 200;
      while (clock() < until) await tick();
    };
    await settle();
    expect(ledLevel(sim, 'led:D9')).toBe(0);
    sim.setInput('button:D2', 1);
    await settle();
    expect(ledLevel(sim, 'led:D9')).toBeGreaterThan(0.75);
    sim.setInput('button:D2', 0);
    await settle();
    expect(ledLevel(sim, 'led:D9')).toBe(0);
    run.stop();
    await done;
  });

  it('a potentiometer dims an LED and its reading is printed 0–100', async () => {
    const level = () => block('sensor_analog_level', { fields: { SENSOR: 'POT', PIN: 'A0' } });
    const ws = workspace([program(forever(block('basic_led_brightness', { fields: { PIN: '3' }, inputs: { LEVEL: level() } }), println(level()), wait(0.1)))]);
    const { sim, run, printed, clock } = simulate(ws);
    const done = run.run();
    const settle = async () => {
      const until = clock() + 400;
      while (clock() < until) await tick();
    };
    sim.setInput('pot:D14', 0);
    await settle();
    expect(ledLevel(sim, 'led:D3')).toBe(0);
    sim.setInput('pot:D14', 1);
    await settle();
    expect(ledLevel(sim, 'led:D3')).toBeGreaterThan(0.75);
    run.stop();
    await done;
    expect(printed).toContain('0\n');
    expect(printed).toContain('100\n');
  });

  it('the traffic-light block lights the right colours', async () => {
    const light = (l: string) => block('act_traffic_light', { fields: { RED: '10', YELLOW: '11', GREEN: '12', LIGHT: l } });
    const { sim, run } = simulate(workspace([program(light('RED_YELLOW'))]));
    expect((await run.run()).outcome).toBe('finished');
    expect(ledLevel(sim, 'led:D10')).toBeGreaterThan(0.7);
    expect(ledLevel(sim, 'led:D11')).toBeGreaterThan(0.7);
    expect(ledLevel(sim, 'led:D12')).toBe(0);
  });

  it('the Tariro motor example drives both virtual motors forward, stops, then reverses', async () => {
    const { sim, run, clock } = simulate(example('tariro-motors'), tariro);
    const speeds: string[] = [];
    sim.onChange((s) => {
      const now = `${s.parts['motor:A']!.level.toFixed(1)},${s.parts['motor:B']!.level.toFixed(1)}`;
      if (speeds.at(-1) !== now) speeds.push(now);
    });
    const done = run.run();
    while (clock() < 4200) await tick();
    run.stop();
    await done;
    expect(speeds).toContain('0.6,0.6'); // both forward at 60 %
    expect(speeds).toContain('0.0,0.0'); // stopped
    expect(speeds).toContain('-0.4,-0.4'); // both backward at 40 %
  });

  it('says which blocks and boards the simulator cannot handle yet', () => {
    const servo = block('act_servo', { fields: { PIN: '9' }, inputs: { ANGLE: n(90) } });
    expect(checkLive(workspace([program(servo)]), uno, registry, 'simulation')).toEqual([{ blockId: servo.id, message: 'The simulator does not model servo motors yet. Run it live or upload it.' }]);
    const lcd = block('lcd_clear');
    expect(checkLive(workspace([program(lcd)]), uno, registry, 'simulation')).toEqual([{ blockId: lcd.id, message: 'This block cannot run in the simulator yet.' }]);
    expect(checkLive(example('blink'), getBoard('malkon-esp32s3'), registry, 'simulation')[0]?.message).toBe('The simulator does not model Malkon ESP32 (ESP32-S3) yet. It supports 5 V Arduino-type boards.');
    expect(checkLive(example('blink'), uno, registry, 'simulation')).toEqual([]);
  });
});
