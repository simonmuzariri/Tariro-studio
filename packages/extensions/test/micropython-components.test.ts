/**
 * Phase 3b: the Basic Components, sensors and Actuators packs in MicroPython. The generated Python
 * is run in CPython against stub `machine`/`dht` modules (upy_run.py) and must do the same to the
 * pins as live mode does for the same blocks. This checks the generated code's logic; it is not a
 * test on a real ESP32 (none is available here).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { generateMicroPython, getBoard, LiveRun, type BlockJson, type LiveBoard, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, EXAMPLES } from '../src/index.js';
import { block, n, program, set, v, wait, workspace } from '../src/build.js';

const registry = createRegistry();
const esp = getBoard('malkon-esp32s3');
const uno = getBoard('arduino-uno');
const python = spawnSync('python3', ['--version']).status === 0;
const runner = join(import.meta.dirname, 'upy_run.py');

interface PyRun {
  log: string[];
  printed: string;
  outcome: string;
  ms: number;
}
function runPython(ws: WorkspaceJson, inputs: Record<string, unknown> = {}): PyRun & { warnings: string[] } {
  const g = generateMicroPython(ws, esp, registry);
  const r = spawnSync('python3', ['-I', runner, JSON.stringify(inputs)], { input: g.code, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${r.stderr}\n--- program ---\n${g.code}`);
  return { ...(JSON.parse(r.stdout) as PyRun), warnings: g.warnings.map((w) => w.message) };
}

async function runLive(ws: WorkspaceJson): Promise<{ log: string[]; printed: string }> {
  const log: string[] = [];
  let printed = '';
  let clock = 0;
  const io: LiveBoard = {
    digitalWrite: async (pin, on) => void log.push(`${pin}=${on ? 1 : 0}`),
    analogWrite: async (pin, value) => void log.push(`${pin}~${value}`),
    servoWrite: async (pin, angle) => void log.push(`${pin}^${angle}`),
    digitalRead: async () => false,
    analogRead: async () => 0,
    analogPin: async (ch) => 14 + ch,
  };
  const host = {
    io,
    sleep: async (ms: number) => {
      clock += ms;
      await new Promise((res) => setImmediate(res));
    },
    now: () => clock,
    print: (text: string) => void (printed += text),
    onBlock: () => {},
  };
  await new LiveRun(ws, uno, registry, host).run();
  return { log, printed };
}

const print = (value: BlockJson) => block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: value } });

/**
 * Writes the generated program makes when it starts, before any block runs (live mode has no
 * start-up phase): an active-low relay is held off, as the C++ does in setup().
 */
const STARTUP: Record<string, string[]> = { '7-segment digit, LED, buzzer, traffic light, relay': ['17=1'] };

const PARITY: Record<string, WorkspaceJson> = {
  'DC motors: set up, run, drive, brake': workspace([
    program(
      block('act_dc_setup', { fields: { MOTOR: '0', DRIVER: 'L298N', IN1: '7', IN2: '8', EN: '5' } }),
      block('act_dc_setup', { fields: { MOTOR: '1', DRIVER: 'TB6612FNG', IN1: '12', IN2: '13', EN: '6' } }),
      block('act_dc_run', { fields: { MOTOR: '0', DIRECTION: 'BACKWARD' }, inputs: { SPEED: n(50) } }),
      block('act_dc_drive', { fields: { MOVE: 'LEFT' }, inputs: { SPEED: n(100) } }),
      block('act_dc_stop', { fields: { MOTOR: 'ALL', HOW: 'BRAKE' } }),
    ),
  ]),
  'servo: set, timed move and sweep': workspace([
    program(
      block('act_servo', { fields: { PIN: '9' }, inputs: { ANGLE: n(0) } }),
      block('act_servo_move', { fields: { PIN: '9' }, inputs: { ANGLE: n(90), SECONDS: n(0.5) } }),
      block('act_servo_sweep', { fields: { PIN: '9' }, inputs: { FROM: n(30), TO: n(150), SECONDS: n(0.2) } }),
    ),
  ]),
  'arm: limits, speed, pose, gripper, home and angle': workspace([
    program(
      block('arm_joint_setup', { fields: { JOINT: '0', PIN: '3' }, inputs: { MIN: n(20), MAX: n(160), HOME: n(90) } }),
      block('arm_joint_setup', { fields: { JOINT: '1', PIN: '4' }, inputs: { MIN: n(0), MAX: n(180), HOME: n(45) } }),
      block('arm_joint_setup', { fields: { JOINT: '4', PIN: '6' }, inputs: { MIN: n(10), MAX: n(70), HOME: n(40) } }),
      block('arm_speed', { inputs: { SPEED: n(180) } }),
      block('arm_joint_move', { fields: { JOINT: '0' }, inputs: { ANGLE: n(200) } }),
      block('arm_pose', { inputs: { BASE: n(60), SHOULDER: n(120), ELBOW: n(90), WRIST: n(90) } }),
      block('arm_gripper', { fields: { ACTION: 'CLOSE' } }),
      block('arm_home'),
      print(block('arm_joint_angle', { fields: { JOINT: '0' } })),
    ),
  ]),
  '7-segment digit, LED, buzzer, traffic light, relay': workspace([
    program(
      block('act_seven_segment_setup', { fields: { FIRST: '2', KIND: 'CA' } }),
      block('act_seven_segment_show', { inputs: { DIGIT: n(7) } }),
      block('basic_led', { fields: { PIN: '13', STATE: 'ON' } }),
      block('basic_buzzer', { fields: { PIN: '11', STATE: 'OFF' } }),
      block('act_traffic_light', { fields: { RED: '14', YELLOW: '15', GREEN: '16', LIGHT: 'RED_YELLOW' } }),
      block('act_relay', { fields: { PIN: '17', STATE: 'ON', ACTIVE: 'LOW' } }),
    ),
  ]),
  'PID keeps its state between steps': workspace([
    program(
      set('m', n(0)),
      print(block('basic_pid', { inputs: { TARGET: n(60), MEASURED: v('m'), KP: n(0.5), KI: n(2), KD: n(0.1) } })),
      wait(1),
      set('m', n(50)),
      block('controls_repeat_ext', {
        inputs: { TIMES: n(3) },
        do: { DO: [print(block('basic_pid', { inputs: { TARGET: n(60), MEASURED: v('m'), KP: n(0.5), KI: n(2), KD: n(0.1) } })), wait(1)] },
      }),
    ),
  ]),
};

/** Python prints whole-valued floats as "30.0" and live mode as "30"; compare the numbers. */
const numbers = (text: string) => text.trim().split('\n').filter(Boolean).map(Number);

describe.skipIf(!python)('MicroPython for the component packs (run against stub hardware)', () => {
  it.each(Object.keys(PARITY))('%s: same pin activity as live mode', async (name) => {
    const ws = PARITY[name]!;
    const py = runPython(ws);
    expect(py.warnings).toEqual([]);
    expect(py.outcome).toBe('finished');
    const live = await runLive(ws);
    expect(py.log).toEqual([...(STARTUP[name] ?? []), ...live.log]);
    expect(numbers(py.printed)).toEqual(numbers(live.printed));
  });

  it('LED brightness and RGB colour become the matching PWM duty', () => {
    const py = runPython(
      workspace([
        program(
          block('basic_led_brightness', { fields: { PIN: '3' }, inputs: { LEVEL: n(50) } }),
          block('act_rgb_led', { fields: { R: '9', G: '10', B: '11' }, inputs: { RV: n(255), GV: n(0), BV: n(128) } }),
        ),
      ]),
    );
    // Each PWM output is created at duty 0 when the program starts, then set by its block.
    expect(py.log).toEqual(['3~0', '9~0', '10~0', '11~0', '3~127', '9~255', '10~0', '11~128']);
  });

  it('encoders count interrupt pulses into turns and wheel distance', () => {
    const ws = workspace([
      program(
        block('enc_setup', { fields: { ENCODER: 'LEFT', KIND: 'SINGLE', PIN_A: '4', PIN_B: '4' } }),
        block('enc_config', { fields: { ENCODER: 'LEFT' }, inputs: { PPR: n(20), GEAR: n(1), DIAMETER: n(65) } }),
      ),
    ]);
    // 40 pulses on a 20-pulse encoder = 2 turns = 2 × 20.42 cm on a 65 mm wheel.
    const after = 'print(tariro_encoder_turns(0)); print(round(tariro_encoder_turns(0) * tariro_encoder_circumference(0), 2))';
    const py = runPython(ws, { pulses: 40, after });
    expect(py.warnings).toEqual([]);
    expect(numbers(py.printed)).toEqual([2, 40.84]);
  });

  it('sensors read through the ADC, the echo timer and the DHT driver', () => {
    const ws = workspace([
      program(
        print(block('sensor_analog_level', { fields: { SENSOR: 'POT', PIN: 'A0' } })),
        print(block('sensor_ultrasonic_cm', { fields: { TRIG: '12', ECHO: '13' } })),
        print(block('sensor_dht', { fields: { MODEL: 'DHT22', READING: 'HUM', PIN: '2' } })),
        print(block('sensor_button_pressed', { fields: { PIN: '5' } })),
      ),
    ]);
    // A0 is GPIO1 on the ESP32-S3; 2048 of 4095 is 50 %. 1166 µs of echo is 20 cm.
    const py = runPython(ws, { analog: { '1': 2048 }, pulse_us: 1166, hum: 55, digital: { '5': 0 } });
    expect(py.warnings).toEqual([]);
    const out = py.printed.trim().split('\n');
    expect(Number(out[0])).toBe(50);
    expect(Number(out[1])).toBeCloseTo(20, 0);
    expect(Number(out[2])).toBe(55);
    expect(out[3]).toBe('True');
  });

  it('a stepper move takes the time its speed says and updates the position', () => {
    const ws = workspace([
      program(
        block('act_stepper_setup', { fields: { STEPPER: '0', DRIVER: 'A4988', STEP: '3', DIR: '4', EN: '5' }, inputs: { SPR: n(200) } }),
        block('act_stepper_speed', { fields: { STEPPER: '0' }, inputs: { RPM: n(60), ACCEL: n(0) } }),
        block('act_stepper_move', { fields: { STEPPER: '0', DIRECTION: 'CW', UNIT: 'TURNS' }, inputs: { AMOUNT: n(1) } }),
        print(block('act_stepper_position', { fields: { STEPPER: '0' } })),
      ),
    ]);
    const py = runPython(ws);
    expect(py.warnings).toEqual([]);
    // One turn at 60 RPM = 200 steps in 1 s.
    expect(py.log.filter((l) => l === '3=1')).toHaveLength(200);
    expect(py.ms).toBeGreaterThanOrEqual(990);
    expect(py.ms).toBeLessThanOrEqual(1010);
    expect(numbers(py.printed)).toEqual([360]);
  });

  it.each(['motor-driver-drive', 'stepper-turn', 'arm-pick-and-place', 'encoder-pid-speed', 'pedestrian-crossing'])(
    'the %s example generates MicroPython with no warnings and runs',
    (name) => {
      const py = runPython(EXAMPLES.find((e) => e.name === name)!.workspace, { limit_s: 20 });
      expect(py.warnings).toEqual([]);
      expect(['finished', 'time limit']).toContain(py.outcome);
      expect(py.log.length).toBeGreaterThan(0);
    },
  );
});
