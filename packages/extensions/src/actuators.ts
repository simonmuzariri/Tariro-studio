/**
 * Actuators: DC motors through driver boards, servo motors, stepper motors and servo robotic arms.
 * It also owns the simple output blocks (relay, traffic light, 7-segment digit, RGB LED), which
 * are listed in the Basic Components category.
 */
import { ORDER, type EmitContext, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { dropdown, include, num, pinArg, pinField, pinId, pinMode, STATEMENT, valueIn } from './util.js';
import { outputsLive } from './live.js';

const STYLE = 'actuators_blocks';

const MOTORS: Array<[string, string]> = [['M1', '0'], ['M2', '1'], ['M3', '2'], ['M4', '3']];
const STEPPERS: Array<[string, string]> = [['1', '0'], ['2', '1']];
const JOINTS: Array<[string, string]> = [['base', '0'], ['shoulder', '1'], ['elbow', '2'], ['wrist', '3'], ['gripper', '4']];

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'act_servo',
    json: {
      type: 'act_servo',
      message0: 'set servo on pin %1 to %2 degrees',
      args0: [pinArg('digital', '9'), valueIn('ANGLE', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Turn a servo motor to an angle from 0 to 180 degrees.',
    },
  },
  {
    type: 'act_relay',
    json: {
      type: 'act_relay',
      message0: 'turn relay / pump on pin %1 %2 %3',
      args0: [
        pinArg('digital', '8'),
        dropdown('STATE', [['on', 'ON'], ['off', 'OFF']]),
        dropdown('ACTIVE', [['(module switches on LOW)', 'LOW'], ['(module switches on HIGH)', 'HIGH']]),
      ],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Switch a relay module — for example the water pump. Most blue relay modules switch on with LOW.',
    },
  },
  {
    type: 'act_traffic_light',
    json: {
      type: 'act_traffic_light',
      message0: 'traffic light red %1 yellow %2 green %3 show %4',
      args0: [
        pinArg('digital', '10', 'RED'),
        pinArg('digital', '11', 'YELLOW'),
        pinArg('digital', '12', 'GREEN'),
        dropdown('LIGHT', [['red', 'RED'], ['yellow', 'YELLOW'], ['green', 'GREEN'], ['red + yellow', 'RED_YELLOW'], ['all off', 'OFF']]),
      ],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Traffic light module: turns on the chosen light(s) and the others off.',
    },
  },
  {
    type: 'act_seven_segment_setup',
    json: {
      type: 'act_seven_segment_setup',
      message0: 'set up 7-segment display: segments a–g on 7 pins in a row from %1, %2',
      args0: [
        dropdown('FIRST', ['2', '3', '4', '5', '6', '7'].map((p) => [`D${p}`, p])),
        dropdown('KIND', [['common cathode', 'CC'], ['common anode', 'CA']]),
      ],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Wire segments a, b, c, d, e, f, g to seven pins in a row. Put this in "when board starts up".',
    },
  },
  {
    type: 'act_seven_segment_show',
    json: {
      type: 'act_seven_segment_show',
      message0: 'show digit %1 on 7-segment display',
      args0: [valueIn('DIGIT', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Shows 0–9. Any other number blanks the display.',
    },
  },
  {
    type: 'act_rgb_led',
    json: {
      type: 'act_rgb_led',
      message0: 'RGB LED red pin %1 green pin %2 blue pin %3 colour R %4 G %5 B %6',
      args0: [
        pinArg('pwm', '9', 'R'),
        pinArg('pwm', '10', 'G'),
        pinArg('pwm', '11', 'B'),
        valueIn('RV', 'Number'),
        valueIn('GV', 'Number'),
        valueIn('BV', 'Number'),
      ],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Mix a colour on a common-cathode RGB LED: each part 0 (off) to 255 (full).',
    },
  },
  // ───────── DC motors through a driver board ─────────
  {
    type: 'act_dc_setup',
    json: {
      type: 'act_dc_setup',
      message0: 'set up DC motor %1 on %2: IN1 %3 IN2 %4 speed pin %5',
      args0: [dropdown('MOTOR', MOTORS), dropdown('DRIVER', [['L298N', 'L298N'], ['TB6612FNG', 'TB6612FNG']]), pinArg('digital', '7', 'IN1'), pinArg('digital', '8', 'IN2'), pinArg('pwm', '9', 'EN')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Both drivers take two direction pins and one PWM speed pin per motor (ENA/ENB on the L298N, PWMA/PWMB on the TB6612FNG). On a TB6612FNG, connect STBY to 5 V.',
    },
  },
  {
    type: 'act_dc_run',
    json: {
      type: 'act_dc_run',
      message0: 'run DC motor %1 %2 at %3 %% speed',
      args0: [dropdown('MOTOR', MOTORS), dropdown('DIRECTION', [['forward', 'FORWARD'], ['backward', 'BACKWARD']]), valueIn('SPEED', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Speed 0 to 100. Swap the two motor wires if "forward" turns the wrong way.',
    },
  },
  {
    type: 'act_dc_stop',
    json: {
      type: 'act_dc_stop',
      message0: 'stop DC motor %1 %2',
      args0: [dropdown('MOTOR', [...MOTORS, ['all', 'ALL']]), dropdown('HOW', [['and coast', 'COAST'], ['and brake', 'BRAKE']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Coast lets the motor spin down; brake stops it quickly.',
    },
  },
  {
    type: 'act_dc_drive',
    json: {
      type: 'act_dc_drive',
      message0: 'drive %1 at %2 %% speed (left motor M1, right motor M2)',
      args0: [dropdown('MOVE', [['forward', 'FORWARD'], ['backward', 'BACKWARD'], ['turn left', 'LEFT'], ['turn right', 'RIGHT'], ['spin left', 'SPIN_LEFT'], ['spin right', 'SPIN_RIGHT']]), valueIn('SPEED', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Controls two motors together for a two-wheel robot. Turning slows the inner wheel; spinning runs the wheels in opposite directions.',
    },
  },
  // ───────── servo motion ─────────
  {
    type: 'act_servo_move',
    json: {
      type: 'act_servo_move',
      message0: 'move servo on pin %1 to %2 ° over %3 seconds',
      args0: [pinArg('digital', '9'), valueIn('ANGLE', 'Number'), valueIn('SECONDS', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Moves smoothly from where the servo is now. The program waits until the move has finished.',
    },
  },
  {
    type: 'act_servo_sweep',
    json: {
      type: 'act_servo_sweep',
      message0: 'sweep servo on pin %1 from %2 ° to %3 ° and back, %4 seconds each way',
      args0: [pinArg('digital', '9'), valueIn('FROM', 'Number'), valueIn('TO', 'Number'), valueIn('SECONDS', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'One sweep there and back. Put it in a loop to keep sweeping.',
    },
  },
  // ───────── stepper motors (STEP/DIR drivers) ─────────
  {
    type: 'act_stepper_setup',
    json: {
      type: 'act_stepper_setup',
      message0: 'set up stepper %1 on %2: STEP %3 DIR %4 EN %5, %6 steps per turn',
      args0: [dropdown('STEPPER', STEPPERS), dropdown('DRIVER', [['A4988', 'A4988'], ['DRV8825', 'DRV8825']]), pinArg('digital', '3', 'STEP'), pinArg('digital', '4', 'DIR'), pinArg('digital', '5', 'EN'), valueIn('SPR', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Steps per turn is 200 for most motors (1.8° per step), times the microstepping set on the driver. EN switches the motor current on and off.',
    },
  },
  {
    type: 'act_stepper_speed',
    json: {
      type: 'act_stepper_speed',
      message0: 'set stepper %1 speed %2 RPM, acceleration %3 RPM per second',
      args0: [dropdown('STEPPER', STEPPERS), valueIn('RPM', 'Number'), valueIn('ACCEL', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Top speed and how quickly the motor speeds up and slows down. Use acceleration 0 to start at full speed.',
    },
  },
  {
    type: 'act_stepper_move',
    json: {
      type: 'act_stepper_move',
      message0: 'turn stepper %1 %2 by %3 %4',
      args0: [dropdown('STEPPER', STEPPERS), dropdown('DIRECTION', [['clockwise', 'CW'], ['anticlockwise', 'CCW']]), valueIn('AMOUNT', 'Number'), dropdown('UNIT', [['steps', 'STEPS'], ['degrees', 'DEGREES'], ['turns', 'TURNS']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'The program waits until the move has finished.',
    },
  },
  {
    type: 'act_stepper_goto',
    json: {
      type: 'act_stepper_goto',
      message0: 'move stepper %1 to position %2 degrees',
      args0: [dropdown('STEPPER', STEPPERS), valueIn('ANGLE', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Position is counted from where the motor was when the program started, or from the last "set position to zero".',
    },
  },
  {
    type: 'act_stepper_zero',
    json: {
      type: 'act_stepper_zero',
      message0: 'set stepper %1 position to zero',
      args0: [dropdown('STEPPER', STEPPERS)],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Calls the current position 0 degrees.',
    },
  },
  {
    type: 'act_stepper_power',
    json: {
      type: 'act_stepper_power',
      message0: 'stepper %1 motor current %2',
      args0: [dropdown('STEPPER', STEPPERS), dropdown('STATE', [['off (free to turn)', 'OFF'], ['on (holds position)', 'ON']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Stops the motor holding its position, which keeps it cool. Needs the EN pin connected.',
    },
  },
  {
    type: 'act_stepper_position',
    json: {
      type: 'act_stepper_position',
      message0: 'stepper %1 position (degrees)',
      args0: [dropdown('STEPPER', STEPPERS)],
      output: 'Number',
      style: STYLE,
      tooltip: 'Where the program has moved the motor to. A stepper has no sensor, so a stalled motor is not noticed.',
    },
  },
  // ───────── robotic arm (servo joints) ─────────
  {
    type: 'arm_joint_setup',
    json: {
      type: 'arm_joint_setup',
      message0: 'set up arm %1 on pin %2: limits %3 ° to %4 °, home %5 °',
      args0: [dropdown('JOINT', JOINTS), pinArg('digital', '9'), valueIn('MIN', 'Number'), valueIn('MAX', 'Number'), valueIn('HOME', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'One servo of the arm. The limits stop the joint being driven into the frame; for the gripper they are the closed and open angles.',
    },
  },
  {
    type: 'arm_speed',
    json: {
      type: 'arm_speed',
      message0: 'set arm speed to %1 degrees per second',
      args0: [valueIn('SPEED', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'How fast the joints move. Slow (30 to 60) is kinder to small servos.',
    },
  },
  {
    type: 'arm_joint_move',
    json: {
      type: 'arm_joint_move',
      message0: 'move arm %1 to %2 °',
      args0: [dropdown('JOINT', JOINTS), valueIn('ANGLE', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Moves one joint at the arm speed, staying inside its limits.',
    },
  },
  {
    type: 'arm_pose',
    json: {
      type: 'arm_pose',
      message0: 'move arm to base %1 ° shoulder %2 ° elbow %3 ° wrist %4 °',
      args0: [valueIn('BASE', 'Number'), valueIn('SHOULDER', 'Number'), valueIn('ELBOW', 'Number'), valueIn('WRIST', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Moves the four joints together so they all arrive at the same moment. Joints that were not set up are skipped.',
    },
  },
  {
    type: 'arm_home',
    json: { type: 'arm_home', message0: 'move arm to home position', ...STATEMENT, style: STYLE, tooltip: 'Every joint goes to the home angle given in its set-up block.' },
  },
  {
    type: 'arm_gripper',
    json: {
      type: 'arm_gripper',
      message0: '%1 gripper',
      args0: [dropdown('ACTION', [['open', 'OPEN'], ['close', 'CLOSE']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Open moves the gripper to its upper limit, close to its lower limit.',
    },
  },
  {
    type: 'arm_joint_angle',
    json: {
      type: 'arm_joint_angle',
      message0: 'arm %1 angle',
      args0: [dropdown('JOINT', JOINTS)],
      output: 'Number',
      style: STYLE,
      tooltip: 'The angle the program last sent to this joint.',
    },
  },
];

const LIGHTS: Record<string, [boolean, boolean, boolean]> = {
  RED: [true, false, false],
  YELLOW: [false, true, false],
  GREEN: [false, false, true],
  RED_YELLOW: [true, true, false],
  OFF: [false, false, false],
};

function sevenSegmentHelper(ctx: EmitContext): void {
  ctx.contribute({
    section: 'functions',
    key: 'act:7seg',
    priority: 20,
    code: [
      '// Segments a–g for digits 0–9 (bit 0 = a).',
      'const uint8_t SEVEN_SEG_DIGITS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};',
      '',
      'void tariroSevenSegment(double value) {',
      '  int d = (int)value;',
      '  uint8_t bits = (d >= 0 && d <= 9 && d == value) ? SEVEN_SEG_DIGITS[d] : 0;',
      '  for (uint8_t i = 0; i < 7; i++) {',
      '    bool on = bits & (1 << i);',
      '    digitalWrite(sevenSegFirst + i, on != sevenSegCommonAnode ? HIGH : LOW);',
      '  }',
      '}',
    ].join('\n'),
  });
}


const statement = (emit: (ctx: EmitContext) => string): Emitter => ({ kind: 'statement', emit });
/** A dropdown that holds an array index, kept inside 0…max even if a project file was edited by hand. */
const index = (ctx: EmitContext, field: string, max: number): number => Math.min(Math.max(Math.trunc(Number(ctx.field(field)) || 0), 0), max);
const servoHeader = (ctx: EmitContext) => include(ctx, ctx.board.family === 'esp32' ? 'ESP32Servo.h' : 'Servo.h');

/** The Servo object for the block's pin, plus a variable remembering the last angle sent to it. */
function servoInstance(ctx: EmitContext): string {
  const pin = pinField(ctx, 'digital');
  servoHeader(ctx);
  const name = `servo_${pinId(pin)}`;
  ctx.contribute({ section: 'globals', key: `servo:${pin}`, code: `Servo ${name};`, priority: 20 });
  ctx.contribute({ section: 'globals', key: `servo:angle:${pin}`, code: `double ${name}_angle = 90;`, priority: 21 });
  ctx.contribute({ section: 'setup.init', key: `servo:attach:${pin}`, code: `${name}.attach(${pin});`, priority: 20 });
  return name;
}

function servoMoveHelper(ctx: EmitContext): void {
  ctx.contribute({
    section: 'functions',
    key: 'act:servo:move',
    priority: 20,
    code: [
      '// Move a servo from its current angle to a new one in small steps (20 ms apart).',
      'void tariroServoMove(Servo &servo, double &current, double target, double seconds) {',
      '  target = constrain(target, 0.0, 180.0);',
      '  long steps = seconds <= 0 ? 0 : (long)(seconds * 50.0);',
      '  double start = current;',
      '  for (long i = 1; i <= steps; i++) {',
      '    servo.write((int)(start + (target - start) * i / steps));',
      '    delay(20);',
      '  }',
      '  servo.write((int)target);',
      '  current = target;',
      '}',
    ].join('\n'),
  });
}

/** Up to four DC motors on L298N or TB6612FNG channels: two direction pins and one PWM pin each. */
function dcRuntime(ctx: EmitContext): void {
  ctx.contribute({
    section: 'globals',
    key: 'act:dc:state',
    priority: 20,
    code: 'struct TariroDcMotor {\n  uint8_t in1;\n  uint8_t in2;\n  uint8_t en;\n  bool ready;\n};\nTariroDcMotor tariroDc[4] = {};',
  });
  ctx.contribute({
    section: 'functions',
    key: 'act:dc:fn',
    priority: 20,
    code: [
      'void tariroDcBegin(uint8_t i, uint8_t in1, uint8_t in2, uint8_t en) {',
      '  tariroDc[i] = {in1, in2, en, true};',
      '  pinMode(in1, OUTPUT);',
      '  pinMode(in2, OUTPUT);',
      '  pinMode(en, OUTPUT);',
      '  digitalWrite(in1, LOW);',
      '  digitalWrite(in2, LOW);',
      '  analogWrite(en, 0);',
      '}',
      '',
      '// speedPercent 0–100. A motor that was not set up is left alone.',
      'void tariroDcRun(uint8_t i, bool forward, double speedPercent) {',
      '  if (!tariroDc[i].ready) return;',
      '  digitalWrite(tariroDc[i].in1, forward ? HIGH : LOW);',
      '  digitalWrite(tariroDc[i].in2, forward ? LOW : HIGH);',
      '  analogWrite(tariroDc[i].en, constrain((int)(speedPercent * 255.0 / 100.0), 0, 255));',
      '}',
      '',
      '// Brake: both inputs HIGH with the driver enabled shorts the motor. Coast: driver disabled.',
      'void tariroDcStop(uint8_t i, bool brake) {',
      '  if (!tariroDc[i].ready) return;',
      '  digitalWrite(tariroDc[i].in1, brake ? HIGH : LOW);',
      '  digitalWrite(tariroDc[i].in2, brake ? HIGH : LOW);',
      '  analogWrite(tariroDc[i].en, brake ? 255 : 0);',
      '}',
    ].join('\n'),
  });
}

/** Two steppers on STEP/DIR drivers (A4988, DRV8825) with a linear speed ramp. Moves block until done. */
function stepperRuntime(ctx: EmitContext): void {
  ctx.contribute({
    section: 'globals',
    key: 'act:stepper:state',
    priority: 20,
    code: 'struct TariroStepper {\n  uint8_t stepPin;\n  uint8_t dirPin;\n  uint8_t enPin;\n  bool ready;\n  double stepsPerTurn;\n  double stepsPerSecond;\n  double acceleration;\n  long position;\n};\n// Defaults: 200 steps per turn, 60 RPM, no ramp.\nTariroStepper tariroSteppers[2] = {{0, 0, 0, false, 200.0, 200.0, 0.0, 0}, {0, 0, 0, false, 200.0, 200.0, 0.0, 0}};',
  });
  ctx.contribute({
    section: 'functions',
    key: 'act:stepper:fn',
    priority: 20,
    code: [
      'void tariroStepperBegin(uint8_t i, uint8_t stepPin, uint8_t dirPin, uint8_t enPin, double stepsPerTurn) {',
      '  TariroStepper &s = tariroSteppers[i];',
      '  double rpm = s.stepsPerSecond * 60.0 / s.stepsPerTurn;',
      '  s.stepPin = stepPin;',
      '  s.dirPin = dirPin;',
      '  s.enPin = enPin;',
      '  if (stepsPerTurn > 0) s.stepsPerTurn = stepsPerTurn;',
      '  s.stepsPerSecond = rpm * s.stepsPerTurn / 60.0;',
      '  s.ready = true;',
      '  pinMode(stepPin, OUTPUT);',
      '  pinMode(dirPin, OUTPUT);',
      '  pinMode(enPin, OUTPUT);',
      '  digitalWrite(enPin, LOW); // EN is active LOW: motor current on',
      '}',
      '',
      'void tariroStepperSpeed(uint8_t i, double rpm, double rpmPerSecond) {',
      '  TariroStepper &s = tariroSteppers[i];',
      '  s.stepsPerSecond = constrain(rpm, 1.0, 600.0) * s.stepsPerTurn / 60.0;',
      '  s.acceleration = max(rpmPerSecond, 0.0) * s.stepsPerTurn / 60.0;',
      '}',
      '',
      '// Step with a trapezoid speed profile: speed up, cruise, slow down. Positive = clockwise.',
      'void tariroStepperMove(uint8_t i, long steps) {',
      '  TariroStepper &s = tariroSteppers[i];',
      '  if (!s.ready || steps == 0) return;',
      '  digitalWrite(s.dirPin, steps > 0 ? HIGH : LOW);',
      '  long total = labs(steps);',
      '  double startSpeed = s.acceleration > 0 ? min(s.stepsPerSecond, max(s.acceleration * 0.05, 20.0)) : s.stepsPerSecond;',
      '  double speed = startSpeed;',
      '  for (long n = 0; n < total; n++) {',
      '    if (s.acceleration > 0) {',
      '      // Steps still needed to slow down from the current speed.',
      '      double stopSteps = (speed * speed - startSpeed * startSpeed) / (2.0 * s.acceleration);',
      '      if (total - n <= stopSteps) speed = max(startSpeed, speed - s.acceleration / speed);',
      '      else if (speed < s.stepsPerSecond) speed = min(s.stepsPerSecond, speed + s.acceleration / speed);',
      '    }',
      '    unsigned long halfPeriod = (unsigned long)(500000.0 / speed);',
      '    digitalWrite(s.stepPin, HIGH);',
      '    delayMicroseconds(halfPeriod > 16000UL ? 16000UL : halfPeriod);',
      '    digitalWrite(s.stepPin, LOW);',
      '    if (halfPeriod > 16000UL) delay((halfPeriod * 2UL - 16000UL) / 1000UL);',
      '    else delayMicroseconds(halfPeriod);',
      '  }',
      '  s.position += steps;',
      '}',
    ].join('\n'),
  });
}

/** A servo arm with up to five joints (base, shoulder, elbow, wrist, gripper), limits and timed moves. */
function armRuntime(ctx: EmitContext): void {
  servoHeader(ctx);
  ctx.contribute({
    section: 'globals',
    key: 'act:arm:state',
    priority: 20,
    code: 'struct TariroArmJoint {\n  Servo servo;\n  bool ready;\n  double minAngle;\n  double maxAngle;\n  double home;\n  double angle;\n};\n// 0 base, 1 shoulder, 2 elbow, 3 wrist, 4 gripper.\nTariroArmJoint tariroArm[5];\ndouble tariroArmTarget[5] = {90, 90, 90, 90, 90};\ndouble tariroArmSpeed = 60; // degrees per second',
  });
  ctx.contribute({
    section: 'functions',
    key: 'act:arm:fn',
    priority: 20,
    code: [
      '// Attach a joint and put it at its home angle (a servo cannot report where it is).',
      'void tariroArmJoint(uint8_t i, uint8_t pin, double minAngle, double maxAngle, double home) {',
      '  TariroArmJoint &j = tariroArm[i];',
      '  j.minAngle = constrain(min(minAngle, maxAngle), 0.0, 180.0);',
      '  j.maxAngle = constrain(max(minAngle, maxAngle), 0.0, 180.0);',
      '  j.home = constrain(home, j.minAngle, j.maxAngle);',
      '  j.angle = j.home;',
      '  tariroArmTarget[i] = j.home;',
      '  j.servo.attach(pin);',
      '  j.servo.write((int)j.home);',
      '  j.ready = true;',
      '}',
      '',
      '// Move the joints in `mask` to their targets together, so they arrive at the same moment.',
      'void tariroArmGo(uint8_t mask) {',
      '  double start[5];',
      '  double furthest = 0;',
      '  for (uint8_t i = 0; i < 5; i++) {',
      '    TariroArmJoint &j = tariroArm[i];',
      '    start[i] = j.angle;',
      '    if (!(mask & (1 << i)) || !j.ready) continue;',
      '    tariroArmTarget[i] = constrain(tariroArmTarget[i], j.minAngle, j.maxAngle);',
      '    furthest = max(furthest, fabs(tariroArmTarget[i] - j.angle));',
      '  }',
      '  long steps = (long)(furthest / tariroArmSpeed * 50.0); // one step every 20 ms',
      '  for (long n = 1; n <= steps; n++) {',
      '    for (uint8_t i = 0; i < 5; i++) {',
      '      TariroArmJoint &j = tariroArm[i];',
      '      if (!(mask & (1 << i)) || !j.ready) continue;',
      '      j.servo.write((int)(start[i] + (tariroArmTarget[i] - start[i]) * n / steps));',
      '    }',
      '    delay(20);',
      '  }',
      '  for (uint8_t i = 0; i < 5; i++) {',
      '    TariroArmJoint &j = tariroArm[i];',
      '    if (!(mask & (1 << i)) || !j.ready) continue;',
      '    j.servo.write((int)tariroArmTarget[i]);',
      '    j.angle = tariroArmTarget[i];',
      '  }',
      '}',
    ].join('\n'),
  });
}

const emitters: Record<string, Emitter> = {
  act_servo: {
    kind: 'statement',
    emit: (ctx) => {
      const name = servoInstance(ctx);
      // Remember the angle so a later "move servo … over … seconds" starts from the right place.
      return `${name}_angle = constrain(${ctx.value('ANGLE', ORDER.COMMA, '90')}, 0.0, 180.0);\n${name}.write((int)${name}_angle);`;
    },
  },
  act_relay: {
    kind: 'statement',
    emit: (ctx) => {
      const pin = pinField(ctx, 'digital');
      const activeLow = ctx.field('ACTIVE') !== 'HIGH';
      // Start in the "off" state: an active-LOW relay would otherwise click on at power-up.
      ctx.contribute({ section: 'setup.init', key: `relay:off:${pin}`, code: `digitalWrite(${pin}, ${activeLow ? 'HIGH' : 'LOW'});`, priority: 9 });
      pinMode(ctx, pin, 'OUTPUT');
      const on = ctx.field('STATE') !== 'OFF';
      return `digitalWrite(${pin}, ${on !== activeLow ? 'HIGH' : 'LOW'});`;
    },
  },
  act_traffic_light: {
    kind: 'statement',
    emit: (ctx) => {
      const pins = ['RED', 'YELLOW', 'GREEN'].map((k) => pinField(ctx, 'digital', k));
      const states = LIGHTS[ctx.field('LIGHT')] ?? LIGHTS['OFF']!;
      pins.forEach((p) => pinMode(ctx, p, 'OUTPUT'));
      return pins.map((p, i) => `digitalWrite(${p}, ${states[i] ? 'HIGH' : 'LOW'});`).join('\n');
    },
  },
  act_seven_segment_setup: {
    kind: 'statement',
    emit: (ctx) => {
      const first = Number(ctx.field('FIRST')) || 2;
      const anode = ctx.field('KIND') === 'CA';
      ctx.contribute({
        section: 'globals',
        key: 'act:7seg:cfg',
        code: `uint8_t sevenSegFirst = ${first};\nbool sevenSegCommonAnode = ${anode};`,
        priority: 20,
        override: true,
      });
      sevenSegmentHelper(ctx);
      return `for (uint8_t i = 0; i < 7; i++) pinMode(sevenSegFirst + i, OUTPUT);`;
    },
  },
  act_seven_segment_show: {
    kind: 'statement',
    emit: (ctx) => {
      ctx.contribute({ section: 'globals', key: 'act:7seg:cfg', code: 'uint8_t sevenSegFirst = 2;\nbool sevenSegCommonAnode = false;', priority: 20 });
      sevenSegmentHelper(ctx);
      return `tariroSevenSegment(${ctx.value('DIGIT', ORDER.NONE, '0')});`;
    },
  },
  act_rgb_led: {
    kind: 'statement',
    emit: (ctx) => {
      const pins = ['R', 'G', 'B'].map((k) => pinField(ctx, 'pwm', k));
      pins.forEach((p) => pinMode(ctx, p, 'OUTPUT'));
      return pins.map((p, i) => `analogWrite(${p}, constrain((int)(${ctx.value(['RV', 'GV', 'BV'][i]!, ORDER.NONE, '0')}), 0, 255));`).join('\n');
    },
  },
  // ───────── DC motors ─────────
  act_dc_setup: statement((ctx) => {
    dcRuntime(ctx);
    const [in1, in2] = [pinField(ctx, 'digital', 'IN1'), pinField(ctx, 'digital', 'IN2')];
    const en = pinField(ctx, 'pwm', 'EN');
    return `tariroDcBegin(${index(ctx, 'MOTOR', 3)}, ${in1}, ${in2}, ${en});`;
  }),
  act_dc_run: statement((ctx) => {
    dcRuntime(ctx);
    return `tariroDcRun(${index(ctx, 'MOTOR', 3)}, ${ctx.field('DIRECTION') !== 'BACKWARD'}, ${ctx.value('SPEED', ORDER.COMMA, '0')});`;
  }),
  act_dc_stop: statement((ctx) => {
    dcRuntime(ctx);
    const brake = ctx.field('HOW') === 'BRAKE';
    const which = ctx.field('MOTOR') === 'ALL' ? [0, 1, 2, 3] : [index(ctx, 'MOTOR', 3)];
    return which.map((i) => `tariroDcStop(${i}, ${brake});`).join('\n');
  }),
  act_dc_drive: statement((ctx) => {
    dcRuntime(ctx);
    const speed = ctx.value('SPEED', ORDER.COMMA, '0');
    // [left forward?, left factor, right forward?, right factor]
    const moves: Record<string, [boolean, string, boolean, string]> = {
      FORWARD: [true, '1.0', true, '1.0'],
      BACKWARD: [false, '1.0', false, '1.0'],
      LEFT: [true, '0.4', true, '1.0'],
      RIGHT: [true, '1.0', true, '0.4'],
      SPIN_LEFT: [false, '1.0', true, '1.0'],
      SPIN_RIGHT: [true, '1.0', false, '1.0'],
    };
    const [lf, lk, rf, rk] = moves[ctx.field('MOVE')] ?? moves['FORWARD']!;
    const scaled = (k: string) => (k === '1.0' ? speed : `(${speed}) * ${k}`);
    return `tariroDcRun(0, ${lf}, ${scaled(lk)});\ntariroDcRun(1, ${rf}, ${scaled(rk)});`;
  }),

  // ───────── servo motion ─────────
  act_servo_move: statement((ctx) => {
    const name = servoInstance(ctx);
    servoMoveHelper(ctx);
    return `tariroServoMove(${name}, ${name}_angle, ${ctx.value('ANGLE', ORDER.COMMA, '90')}, ${ctx.value('SECONDS', ORDER.COMMA, '1')});`;
  }),
  act_servo_sweep: statement((ctx) => {
    const name = servoInstance(ctx);
    servoMoveHelper(ctx);
    const [from, to, secs] = [ctx.value('FROM', ORDER.COMMA, '0'), ctx.value('TO', ORDER.COMMA, '180'), ctx.value('SECONDS', ORDER.COMMA, '1')];
    return `tariroServoMove(${name}, ${name}_angle, ${from}, 0);\ntariroServoMove(${name}, ${name}_angle, ${to}, ${secs});\ntariroServoMove(${name}, ${name}_angle, ${from}, ${secs});`;
  }),

  // ───────── steppers ─────────
  act_stepper_setup: statement((ctx) => {
    stepperRuntime(ctx);
    const pins = ['STEP', 'DIR', 'EN'].map((k) => pinField(ctx, 'digital', k));
    return `tariroStepperBegin(${index(ctx, 'STEPPER', 1)}, ${pins.join(', ')}, ${ctx.value('SPR', ORDER.COMMA, '200')});`;
  }),
  act_stepper_speed: statement((ctx) => {
    stepperRuntime(ctx);
    return `tariroStepperSpeed(${index(ctx, 'STEPPER', 1)}, ${ctx.value('RPM', ORDER.COMMA, '60')}, ${ctx.value('ACCEL', ORDER.COMMA, '0')});`;
  }),
  act_stepper_move: statement((ctx) => {
    stepperRuntime(ctx);
    const i = index(ctx, 'STEPPER', 1);
    const amount = ctx.value('AMOUNT', ORDER.MULTIPLICATIVE, '0');
    const unit = ctx.field('UNIT');
    const steps = unit === 'DEGREES' ? `${amount} * tariroSteppers[${i}].stepsPerTurn / 360.0` : unit === 'TURNS' ? `${amount} * tariroSteppers[${i}].stepsPerTurn` : amount;
    return `tariroStepperMove(${i}, ${ctx.field('DIRECTION') === 'CCW' ? '-' : ''}lround(${steps}));`;
  }),
  act_stepper_goto: statement((ctx) => {
    stepperRuntime(ctx);
    const i = index(ctx, 'STEPPER', 1);
    return `tariroStepperMove(${i}, lround((${ctx.value('ANGLE', ORDER.NONE, '0')}) * tariroSteppers[${i}].stepsPerTurn / 360.0) - tariroSteppers[${i}].position);`;
  }),
  act_stepper_zero: statement((ctx) => {
    stepperRuntime(ctx);
    return `tariroSteppers[${index(ctx, 'STEPPER', 1)}].position = 0;`;
  }),
  act_stepper_power: statement((ctx) => {
    stepperRuntime(ctx);
    // A4988 and DRV8825: EN is active LOW.
    return `digitalWrite(tariroSteppers[${index(ctx, 'STEPPER', 1)}].enPin, ${ctx.field('STATE') === 'ON' ? 'LOW' : 'HIGH'});`;
  }),
  act_stepper_position: {
    kind: 'value',
    type: 'number',
    emit: (ctx) => {
      stepperRuntime(ctx);
      const i = index(ctx, 'STEPPER', 1);
      return [`tariroSteppers[${i}].position * 360.0 / tariroSteppers[${i}].stepsPerTurn`, ORDER.MULTIPLICATIVE];
    },
  },

  // ───────── robotic arm ─────────
  arm_joint_setup: statement((ctx) => {
    armRuntime(ctx);
    const pin = pinField(ctx, 'digital');
    return `tariroArmJoint(${index(ctx, 'JOINT', 4)}, ${pin}, ${ctx.value('MIN', ORDER.COMMA, '0')}, ${ctx.value('MAX', ORDER.COMMA, '180')}, ${ctx.value('HOME', ORDER.COMMA, '90')});`;
  }),
  arm_speed: statement((ctx) => {
    armRuntime(ctx);
    return `tariroArmSpeed = constrain(${ctx.value('SPEED', ORDER.COMMA, '60')}, 5.0, 360.0);`;
  }),
  arm_joint_move: statement((ctx) => {
    armRuntime(ctx);
    const i = index(ctx, 'JOINT', 4);
    return `tariroArmTarget[${i}] = ${ctx.value('ANGLE', ORDER.NONE, '90')};\ntariroArmGo(1 << ${i});`;
  }),
  arm_pose: statement((ctx) => {
    armRuntime(ctx);
    const lines = ['BASE', 'SHOULDER', 'ELBOW', 'WRIST'].map((k, i) => `tariroArmTarget[${i}] = ${ctx.value(k, ORDER.NONE, '90')};`);
    return [...lines, 'tariroArmGo(0x0F);'].join('\n');
  }),
  arm_home: statement((ctx) => {
    armRuntime(ctx);
    return 'for (uint8_t i = 0; i < 5; i++) tariroArmTarget[i] = tariroArm[i].home;\ntariroArmGo(0x1F);';
  }),
  arm_gripper: statement((ctx) => {
    armRuntime(ctx);
    return `tariroArmTarget[4] = ${ctx.field('ACTION') === 'CLOSE' ? 'tariroArm[4].minAngle' : 'tariroArm[4].maxAngle'};\ntariroArmGo(1 << 4);`;
  }),
  arm_joint_angle: {
    kind: 'value',
    type: 'number',
    emit: (ctx) => {
      armRuntime(ctx);
      return [`tariroArm[${index(ctx, 'JOINT', 4)}].angle`, ORDER.POSTFIX];
    },
  },
};

export const actuatorsExtension: ExtensionManifest = {
  id: 'actuators',
  name: 'Actuators',
  version: '0.2.0',
  category: 'actuators',
  kits: ['Starter', 'Robotics', 'IoT'],
  description: 'DC motors through L298N and TB6612FNG drivers, servo motors, stepper motors through A4988 and DRV8825 drivers, and servo robotic arms.',
  boards: '*',
  libraries: [
    { name: 'Servo', version: '1.3.0', families: ['avr'] },
    { name: 'ESP32Servo', version: '3.2.1', families: ['esp32'] },
  ],
  blocks,
  emitters: { arduino: emitters },
  live: outputsLive,
  toolbox: [
    {
      id: 'actuators',
      name: 'Actuators',
      style: 'actuators_category',
      contents: [
        { kind: 'label', text: 'DC motors (L298N, TB6612FNG)' },
        { kind: 'block', type: 'act_dc_setup' },
        { kind: 'block', type: 'act_dc_run', inputs: { SPEED: num(60) } },
        { kind: 'block', type: 'act_dc_stop' },
        { kind: 'block', type: 'act_dc_drive', inputs: { SPEED: num(60) } },
        { kind: 'label', text: 'Servo motors' },
        { kind: 'block', type: 'act_servo', inputs: { ANGLE: num(90) } },
        { kind: 'block', type: 'act_servo_move', inputs: { ANGLE: num(90), SECONDS: num(1) } },
        { kind: 'block', type: 'act_servo_sweep', inputs: { FROM: num(0), TO: num(180), SECONDS: num(1) } },
        { kind: 'label', text: 'Stepper motors (A4988, DRV8825)' },
        { kind: 'block', type: 'act_stepper_setup', inputs: { SPR: num(200) } },
        { kind: 'block', type: 'act_stepper_speed', inputs: { RPM: num(60), ACCEL: num(120) } },
        { kind: 'block', type: 'act_stepper_move', inputs: { AMOUNT: num(90) }, fields: { UNIT: 'DEGREES' } },
        { kind: 'block', type: 'act_stepper_goto', inputs: { ANGLE: num(0) } },
        { kind: 'block', type: 'act_stepper_zero' },
        { kind: 'block', type: 'act_stepper_power' },
        { kind: 'block', type: 'act_stepper_position' },
        { kind: 'label', text: 'Robotic arm' },
        { kind: 'block', type: 'arm_joint_setup', inputs: { MIN: num(0), MAX: num(180), HOME: num(90) } },
        { kind: 'block', type: 'arm_speed', inputs: { SPEED: num(60) } },
        { kind: 'block', type: 'arm_joint_move', inputs: { ANGLE: num(90) } },
        { kind: 'block', type: 'arm_pose', inputs: { BASE: num(90), SHOULDER: num(90), ELBOW: num(90), WRIST: num(90) } },
        { kind: 'block', type: 'arm_home' },
        { kind: 'block', type: 'arm_gripper' },
        { kind: 'block', type: 'arm_joint_angle' },
      ],
    },
  ],
};
