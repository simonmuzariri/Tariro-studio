/**
 * Encoder, motor-driver, stepper and robotic-arm projects (expansion Phase 2). Like every
 * example they are golden programs: generated, snapshot-compared and compiled for each board
 * they list. Pin choices follow the rule the encoder blocks enforce: channel A on an interrupt
 * pin (2 and 3 on Uno-type boards).
 */
import type { BlockJson } from '@tariro-studio/core';
import type { ExampleProject } from './examples.js';
import { block, forever, n, program, set, t, v, wait, workspace } from './build.js';

const join = (...parts: BlockJson[]) => block('text_join', { extraState: { itemCount: parts.length }, inputs: Object.fromEntries(parts.map((p, i) => [`ADD${i}`, p])) });
const println = (value: BlockJson) => block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: value } });
const ms = (x: number) => block('tariro_wait_ms', { inputs: { MS: n(x) } });
const arith = (op: string, a: BlockJson, b: BlockJson) => block('math_arithmetic', { fields: { OP: op }, inputs: { A: a, B: b } });
const constrain = (value: BlockJson, low: number, high: number) => block('math_constrain', { inputs: { VALUE: value, LOW: n(low), HIGH: n(high) } });
const cmp = (op: string, a: BlockJson, b: BlockJson) => block('logic_compare', { fields: { OP: op }, inputs: { A: a, B: b } });

const encSetup = (enc: string, a: string, b: string, kind = 'QUAD') => block('enc_setup', { fields: { ENCODER: enc, KIND: kind, PIN_A: a, PIN_B: b } });
const encConfig = (enc: string, ppr: number, gear: number, diameter: number) => block('enc_config', { fields: { ENCODER: enc }, inputs: { PPR: n(ppr), GEAR: n(gear), DIAMETER: n(diameter) } });
const encRead = (enc: string, what: string) => block('enc_read', { fields: { ENCODER: enc, WHAT: what } });
const encReset = (enc: string) => block('enc_reset', { fields: { ENCODER: enc } });
const tariroMotor = (m: 'A' | 'B', speed: BlockJson, dir: 'FORWARD' | 'BACKWARD' = 'FORWARD') => block('tariro_motor_run', { fields: { MOTOR: m, DIRECTION: dir }, inputs: { SPEED: speed } });
const tariroStop = () => block('tariro_motor_stop', { fields: { MOTOR: 'BOTH' } });

/** Both wheel encoders on the Tariro: channel A on the two interrupt pins, B on free pins. */
const wheelEncoders = () => [encSetup('LEFT', '2', '8'), encSetup('RIGHT', '3', '9'), encConfig('LEFT', 20, 1, 65), encConfig('RIGHT', 20, 1, 65)];

const encoderSpeed: ExampleProject = {
  name: 'encoder-speed',
  title: 'Measure wheel rotation and speed',
  description: 'Runs the left motor and prints how far the wheel has turned and how fast, ten times a second.',
  kit: 'Robotics',
  boards: ['tariro'],
  workspace: workspace([
    program(
      ...wheelEncoders(),
      tariroMotor('A', n(60)),
      forever(
        println(join(t('turns:'), encRead('LEFT', 'TURNS'), t(', rpm:'), encRead('LEFT', 'RPM'), t(', angle:'), encRead('LEFT', 'ANGLE'))),
        ms(100),
      ),
    ),
  ]),
};

const encoderDistance: ExampleProject = {
  name: 'encoder-distance',
  title: 'Drive exactly 50 cm',
  description: 'Uses the wheel encoder to measure the distance travelled and stops the robot after 50 cm.',
  kit: 'Robotics',
  boards: ['tariro'],
  workspace: workspace([
    program(
      ...wheelEncoders(),
      encReset('ALL'),
      tariroMotor('A', n(60)),
      tariroMotor('B', n(60)),
      block('controls_whileUntil', { fields: { MODE: 'UNTIL' }, inputs: { BOOL: cmp('GTE', encRead('LEFT', 'DISTANCE'), n(50)) }, do: { DO: [ms(10)] } }),
      tariroStop(),
      println(join(t('Travelled (cm): '), encRead('LEFT', 'DISTANCE'))),
    ),
  ]),
};

const encoderStraight: ExampleProject = {
  name: 'encoder-straight-line',
  title: 'Drive in a straight line',
  description: 'Compares the left and right wheel encoders and slows whichever wheel is ahead, so the robot does not drift.',
  kit: 'Robotics',
  boards: ['tariro'],
  workspace: workspace(
    [
      program(
        ...wheelEncoders(),
        encReset('ALL'),
        forever(
          // Positive when the left wheel is ahead: take speed from the left and give it to the right.
          set('correction', constrain(arith('MULTIPLY', block('enc_compare', { fields: { A: 'LEFT', B: 'RIGHT', WHAT: 'COUNT' } }), n(2)), -30, 30)),
          tariroMotor('A', arith('MINUS', n(60), v('correction'))),
          tariroMotor('B', arith('ADD', n(60), v('correction'))),
          ms(50),
        ),
      ),
    ],
    [{ id: 'correction', name: 'correction' }],
  ),
};

const encoderPid: ExampleProject = {
  name: 'encoder-pid-speed',
  title: 'Hold a motor speed with PID',
  description: 'Closed-loop control: a PID controller adjusts the motor power to hold 120 RPM, even when the wheel is loaded. For advanced learners.',
  kit: 'Robotics',
  boards: ['arduino-uno', 'arduino-mega', 'malkon-esp32s3'],
  workspace: workspace(
    [
      program(
        block('act_dc_setup', { fields: { MOTOR: '0', DRIVER: 'L298N', IN1: '7', IN2: '8', EN: '9' } }),
        encSetup('E1', '2', '4'),
        encConfig('E1', 20, 1, 65),
        set('power', n(50)),
        forever(
          set(
            'power',
            constrain(
              arith(
                'ADD',
                v('power'),
                block('basic_pid', { inputs: { TARGET: n(120), MEASURED: encRead('E1', 'RPM'), KP: n(0.05), KI: n(0.02), KD: n(0) } }),
              ),
              0,
              100,
            ),
          ),
          block('act_dc_run', { fields: { MOTOR: '0', DIRECTION: 'FORWARD' }, inputs: { SPEED: v('power') } }),
          println(join(t('rpm:'), encRead('E1', 'RPM'), t(', power:'), v('power'))),
          ms(100),
        ),
      ),
    ],
    [{ id: 'power', name: 'power' }],
  ),
};

const twoWheelDrive: ExampleProject = {
  name: 'motor-driver-drive',
  title: 'Two-wheel robot with a motor driver',
  description: 'Drives two DC motors through an L298N: forward, spin, backward, then brake.',
  kit: 'Robotics',
  boards: ['arduino-uno', 'malkon-one', 'arduino-nano', 'arduino-mega', 'malkon-esp32s3'],
  workspace: workspace([
    program(
      block('act_dc_setup', { fields: { MOTOR: '0', DRIVER: 'L298N', IN1: '7', IN2: '8', EN: '9' } }),
      block('act_dc_setup', { fields: { MOTOR: '1', DRIVER: 'L298N', IN1: '12', IN2: '13', EN: '10' } }),
      forever(
        block('act_dc_drive', { fields: { MOVE: 'FORWARD' }, inputs: { SPEED: n(70) } }),
        wait(2),
        block('act_dc_drive', { fields: { MOVE: 'SPIN_LEFT' }, inputs: { SPEED: n(50) } }),
        wait(0.5),
        block('act_dc_drive', { fields: { MOVE: 'BACKWARD' }, inputs: { SPEED: n(50) } }),
        wait(1),
        block('act_dc_stop', { fields: { MOTOR: 'ALL', HOW: 'BRAKE' } }),
        wait(1),
      ),
    ),
  ]),
};

const stepperTurn: ExampleProject = {
  name: 'stepper-turn',
  title: 'Turn a stepper motor precisely',
  description: 'Sets the speed and acceleration, turns a quarter turn each way, then returns to the start position.',
  kit: 'Robotics',
  boards: ['arduino-uno', 'arduino-mega', 'malkon-esp32s3'],
  workspace: workspace([
    program(
      block('act_stepper_setup', { fields: { STEPPER: '0', DRIVER: 'A4988', STEP: '3', DIR: '4', EN: '5' }, inputs: { SPR: n(200) } }),
      block('act_stepper_speed', { fields: { STEPPER: '0' }, inputs: { RPM: n(60), ACCEL: n(120) } }),
      forever(
        block('act_stepper_move', { fields: { STEPPER: '0', DIRECTION: 'CW', UNIT: 'DEGREES' }, inputs: { AMOUNT: n(90) } }),
        wait(0.5),
        block('act_stepper_move', { fields: { STEPPER: '0', DIRECTION: 'CCW', UNIT: 'TURNS' }, inputs: { AMOUNT: n(1) } }),
        wait(0.5),
        block('act_stepper_goto', { fields: { STEPPER: '0' }, inputs: { ANGLE: n(0) } }),
        println(join(t('position:'), block('act_stepper_position', { fields: { STEPPER: '0' } }))),
        block('act_stepper_power', { fields: { STEPPER: '0', STATE: 'OFF' } }),
        wait(2),
        block('act_stepper_power', { fields: { STEPPER: '0', STATE: 'ON' } }),
      ),
    ),
  ]),
};

const joint = (j: string, pin: string, min: number, max: number, home: number) => block('arm_joint_setup', { fields: { JOINT: j, PIN: pin }, inputs: { MIN: n(min), MAX: n(max), HOME: n(home) } });
const pose = (base: number, shoulder: number, elbow: number, wrist: number) => block('arm_pose', { inputs: { BASE: n(base), SHOULDER: n(shoulder), ELBOW: n(elbow), WRIST: n(wrist) } });
const grip = (action: 'OPEN' | 'CLOSE') => block('arm_gripper', { fields: { ACTION: action } });

const armPickPlace: ExampleProject = {
  name: 'arm-pick-and-place',
  title: 'Robotic arm: pick and place',
  description: 'A five-servo arm picks an object up on the left and puts it down on the right, then goes home. Adjust the angles to suit your arm.',
  kit: 'Robotics',
  boards: ['arduino-uno', 'arduino-mega', 'malkon-esp32s3'],
  workspace: workspace([
    program(
      joint('0', '3', 0, 180, 90),
      joint('1', '5', 30, 150, 90),
      joint('2', '6', 20, 160, 90),
      joint('3', '9', 0, 180, 90),
      joint('4', '10', 40, 110, 110),
      block('arm_speed', { inputs: { SPEED: n(60) } }),
      forever(
        block('arm_home'),
        grip('OPEN'),
        pose(40, 120, 60, 90), // reach down on the left
        grip('CLOSE'),
        pose(40, 80, 100, 90), // lift
        pose(140, 80, 100, 90), // swing to the right
        pose(140, 120, 60, 90), // lower
        grip('OPEN'),
        block('arm_joint_move', { fields: { JOINT: '1' }, inputs: { ANGLE: n(80) } }),
        println(join(t('shoulder at '), block('arm_joint_angle', { fields: { JOINT: '1' } }))),
        wait(1),
      ),
    ),
  ]),
};

export const ROBOTICS_EXAMPLES: ExampleProject[] = [encoderSpeed, encoderDistance, encoderStraight, encoderPid, twoWheelDrive, stepperTurn, armPickPlace];
