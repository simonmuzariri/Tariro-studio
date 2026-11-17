import { describe, expect, it } from 'vitest';
import { generateArduino, getBoard, interruptPins, type WorkspaceJson } from '@tariro-studio/core';
import { BUILT_IN_EXTENSIONS, createRegistry } from '../src/index.js';
import { block, n, program, workspace } from '../src/build.js';

const registry = createRegistry();
const gen = (ws: WorkspaceJson, board = 'arduino-uno') => generateArduino(ws, getBoard(board), registry);
const setup = (a: string, b: string, kind = 'QUAD', enc = 'LEFT') => block('enc_setup', { fields: { ENCODER: enc, KIND: kind, PIN_A: a, PIN_B: b } });
const read = (what: string, enc = 'LEFT') => block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: block('enc_read', { fields: { ENCODER: enc, WHAT: what } }) } });

describe('Tariro Basic Components', () => {
  it('is one built-in category on every board, listing encoders, sensors and simple outputs', () => {
    for (const id of ['tariro', 'arduino-uno', 'arduino-mega', 'malkon-esp32s3']) {
      const cats = registry.toolboxFor(getBoard(id));
      const basic = cats.find((c) => c.id === 'basic')!;
      expect(basic.name).toBe('Basic Components');
      const types = basic.contents.flatMap((i) => (i.kind === 'block' ? [i.type] : []));
      for (const t of ['basic_led', 'sensor_button_pressed', 'sensor_ultrasonic_cm', 'act_relay', 'enc_setup', 'enc_read', 'enc_compare', 'basic_pid']) expect(types).toContain(t);
      // The old Sensors and Outputs categories are gone; Actuators is its own category.
      expect(cats.map((c) => c.id)).not.toContain('sensors');
      expect(cats.find((c) => c.id === 'actuators')?.name).toBe('Actuators');
    }
    for (const id of ['basic', 'sensors', 'actuators']) expect(BUILT_IN_EXTENSIONS.has(id)).toBe(true);
  });

  it('every block listed in a toolbox exists and has an Arduino emitter', () => {
    for (const board of ['tariro', 'malkon-esp32s3'])
      for (const cat of registry.toolboxFor(getBoard(board), ['displays', 'communication', 'iot']))
        for (const item of cat.contents) if (item.kind === 'block') expect(registry.emitter('arduino', item.type), `${cat.name}: ${item.type}`).toBeDefined();
  });
});

describe('rotary encoders', () => {
  it('counts in an interrupt on channel A and reads direction from channel B', () => {
    const r = gen(workspace([program(setup('2', '8'), read('COUNT'))]));
    expect(r.warnings).toEqual([]);
    expect(r.code).toContain('tariroEncoderBegin(0, 2, 8, true);');
    expect(r.code).toContain('attachInterrupt(digitalPinToInterrupt(pinA), isr, quadrature ? CHANGE : RISING);');
    expect(r.code).toContain('volatile long count;');
    expect(r.code).toContain('Serial.println(tariroEncoderCount(0));');
    // The runtime is emitted once however many encoder blocks there are.
    expect(r.code.match(/struct TariroEncoder \{/g)).toHaveLength(1);
  });

  it('knows which pins can interrupt on each board', () => {
    expect(interruptPins(getBoard('arduino-uno'))).toEqual([2, 3]);
    expect(interruptPins(getBoard('tariro'))).toEqual([2, 3]);
    expect(interruptPins(getBoard('arduino-mega'))).toEqual([2, 3, 18, 19, 20, 21]);
    expect(interruptPins(getBoard('malkon-esp32s3'))).toContain(17);

    const ws = workspace([program(setup('8', '9'))]);
    expect(gen(ws, 'arduino-uno').warnings.map((w) => w.message)).toEqual(['Pin 8 cannot count encoder pulses on Arduino Uno. Use 2, 3 for pin A.']);
    expect(gen(ws, 'malkon-esp32s3').warnings).toEqual([]);
    expect(gen(workspace([program(setup('18', '22'))]), 'arduino-mega').warnings).toEqual([]);
  });

  it('a single-channel encoder uses one pin and rising edges', () => {
    const r = gen(workspace([program(setup('3', '8', 'SINGLE', 'E1'))]));
    expect(r.code).toContain('tariroEncoderBegin(2, 3, 3, false);');
    expect(gen(workspace([program(setup('2', '2'))])).warnings[0]?.message).toContain('two different pins');
  });

  it('offers count, position, angle, direction, RPM, speed and wheel distance', () => {
    const code = gen(workspace([program(setup('2', '8'), ...['TURNS', 'ANGLE', 'DIRECTION', 'RPM', 'DEG_PER_S', 'DISTANCE', 'CM_PER_S'].map((w) => read(w)))])).code;
    expect(code).toContain('Serial.println(tariroEncoderTurns(0));');
    expect(code).toContain('Serial.println(tariroEncoderTurns(0) * 360.0);');
    expect(code).toContain('Serial.println((tariroEncoderTurnsPerSecond(0) > 0) - (tariroEncoderTurnsPerSecond(0) < 0));');
    expect(code).toContain('Serial.println(tariroEncoderTurnsPerSecond(0) * 60.0);');
    expect(code).toContain('Serial.println(tariroEncoderTurns(0) * tariroEncoderCircumference(0));');
  });

  it('sets resolution, resets, and compares the two wheels', () => {
    const code = gen(
      workspace([
        program(
          block('enc_config', { fields: { ENCODER: 'RIGHT' }, inputs: { PPR: n(11), GEAR: n(30), DIAMETER: n(48) } }),
          block('enc_reset', { fields: { ENCODER: 'ALL' } }),
          block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: block('enc_compare', { fields: { A: 'LEFT', B: 'RIGHT', WHAT: 'DISTANCE' } }) } }),
        ),
      ]),
    ).code;
    expect(code).toContain('tariroEncoderResolution(1, 11, 30, 48);');
    expect(code).toContain('tariroEncoderReset(3);');
    expect(code).toContain('(tariroEncoderTurns(0) * tariroEncoderCircumference(0)) - (tariroEncoderTurns(1) * tariroEncoderCircumference(1))');
  });

  it('absolute encoders: analog scaling per board, and the AS5600 over I2C', () => {
    const ws = workspace([program(block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: block('enc_absolute_analog', { fields: { PIN: 'A0' } }) } }), block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: block('enc_as5600') } }))]);
    expect(gen(ws, 'arduino-uno').code).toContain('analogRead(A0) * 360.0 / 1023.0');
    expect(gen(ws, 'malkon-esp32s3').code).toContain('analogRead(A0) * 360.0 / 4095.0');
    expect(gen(ws).code).toContain('#include <Wire.h>');
    expect(gen(ws).code).toContain('Wire.beginTransmission(0x36);');
  });

  it('each PID block keeps its own state', () => {
    const pid = () => block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: block('basic_pid', { inputs: { TARGET: n(100), MEASURED: n(0), KP: n(1), KI: n(0), KD: n(0) } }) } });
    const code = gen(workspace([program(pid(), pid())])).code;
    expect(code.match(/^TariroPid \w+ = \{0, 0, 0\};$/gm)).toHaveLength(2);
    expect(code.match(/double tariroPid\(/g)).toHaveLength(1);
  });
});

describe('actuators', () => {
  it('DC motors: set-up, run, differential drive and brake', () => {
    const code = gen(
      workspace([
        program(
          block('act_dc_setup', { fields: { MOTOR: '0', DRIVER: 'TB6612FNG', IN1: '7', IN2: '8', EN: '9' } }),
          block('act_dc_run', { fields: { MOTOR: '0', DIRECTION: 'BACKWARD' }, inputs: { SPEED: n(40) } }),
          block('act_dc_drive', { fields: { MOVE: 'LEFT' }, inputs: { SPEED: n(80) } }),
          block('act_dc_stop', { fields: { MOTOR: 'ALL', HOW: 'BRAKE' } }),
        ),
      ]),
    ).code;
    expect(code).toContain('tariroDcBegin(0, 7, 8, 9);');
    expect(code).toContain('tariroDcRun(0, false, 40);');
    expect(code).toContain('tariroDcRun(0, true, (80) * 0.4);\n  tariroDcRun(1, true, 80);');
    expect(code).toContain('tariroDcStop(3, true);');
  });

  it('warns when the speed pin is not a PWM pin', () => {
    const r = gen(workspace([program(block('act_dc_setup', { fields: { MOTOR: '0', DRIVER: 'L298N', IN1: '7', IN2: '8', EN: '4' } }))]));
    expect(r.warnings.map((w) => w.message)).toEqual(['Pin 4 is not a PWM (~) pin on Arduino Uno.']);
  });

  it('steppers: degrees and turns become steps, and go-to is relative to the tracked position', () => {
    const code = gen(
      workspace([
        program(
          block('act_stepper_setup', { fields: { STEPPER: '1', DRIVER: 'DRV8825', STEP: '3', DIR: '4', EN: '5' }, inputs: { SPR: n(400) } }),
          block('act_stepper_move', { fields: { STEPPER: '1', DIRECTION: 'CCW', UNIT: 'DEGREES' }, inputs: { AMOUNT: n(90) } }),
          block('act_stepper_goto', { fields: { STEPPER: '1' }, inputs: { ANGLE: n(180) } }),
        ),
      ]),
    ).code;
    expect(code).toContain('tariroStepperBegin(1, 3, 4, 5, 400);');
    expect(code).toContain('tariroStepperMove(1, -lround(90 * tariroSteppers[1].stepsPerTurn / 360.0));');
    expect(code).toContain('tariroStepperMove(1, lround((180) * tariroSteppers[1].stepsPerTurn / 360.0) - tariroSteppers[1].position);');
  });

  it('robotic arm: joints with limits, coordinated pose, gripper and home', () => {
    const r = gen(
      workspace([
        program(
          block('arm_joint_setup', { fields: { JOINT: '4', PIN: '10' }, inputs: { MIN: n(40), MAX: n(110), HOME: n(110) } }),
          block('arm_pose', { inputs: { BASE: n(40), SHOULDER: n(120), ELBOW: n(60), WRIST: n(90) } }),
          block('arm_gripper', { fields: { ACTION: 'CLOSE' } }),
          block('arm_home'),
        ),
      ]),
    );
    expect(r.code).toContain('#include <Servo.h>');
    expect(r.code).toContain('tariroArmJoint(4, 10, 40, 110, 110);');
    expect(r.code).toContain('tariroArmGo(0x0F);');
    expect(r.code).toContain('tariroArmTarget[4] = tariroArm[4].minAngle;');
    expect(r.code).toContain('tariroArmTarget[i] = constrain(tariroArmTarget[i], j.minAngle, j.maxAngle);');
    expect(r.libraries).toEqual([{ name: 'Servo', version: '1.3.0' }]);
    expect(gen(workspace([program(block('arm_home'))]), 'malkon-esp32s3').code).toContain('#include <ESP32Servo.h>');
  });
});
