/**
 * Tariro onboard peripherals. The TB6612FNG pin mapping comes from the board definition; while it
 * is a placeholder (`confirmed: false`, IDE_DESIGN.md D3) the generated sketch carries a #warning
 * and every motor block shows a warning in the IDE.
 */
import { ORDER, type EmitContext, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { dropdown, num, pinArg, pinField, pinMode, valueIn } from './util.js';
import { DRIVE_MOVES, tariroLive } from './live.js';
import { distanceHelper } from './sensors.js';
import { encoderRuntime } from './basic.js';

const MOTOR_OPTIONS = [
  ['A (left)', 'A'],
  ['B (right)', 'B'],
];

const MOVE_OPTIONS: Array<[string, string]> = [
  ['forward', 'FORWARD'],
  ['backward', 'BACKWARD'],
  ['turn left', 'LEFT'],
  ['turn right', 'RIGHT'],
  ['spin left', 'SPIN_LEFT'],
  ['spin right', 'SPIN_RIGHT'],
];
const STATEMENT = { inputsInline: true, previousStatement: null, nextStatement: null };
const AUTO = 'tariro_blocks';

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'tariro_drive',
    json: {
      type: 'tariro_drive',
      message0: 'drive %1 at %2 %% speed',
      args0: [dropdown('MOVE', MOVE_OPTIONS), valueIn('SPEED', 'Number')],
      ...STATEMENT,
      style: 'tariro_blocks',
      tooltip: 'Drive the Tariro robot with both motors (A is the left wheel, B the right). Turns slow one wheel; spins run the wheels in opposite directions.',
    },
  },
  // ───────── autonomy (Phase 5c): Upload mode, they use sensor timing the live link cannot give ─────────
  {
    type: 'auto_until_obstacle',
    json: {
      type: 'auto_until_obstacle',
      message0: 'drive forward at %1 %% until something is closer than %2 cm (ultrasonic trig %3 echo %4)',
      args0: [valueIn('SPEED', 'Number'), valueIn('CM', 'Number'), pinArg('digital', '12', 'TRIG'), pinArg('digital', '13', 'ECHO')],
      ...STATEMENT,
      style: AUTO,
      tooltip: 'Drives forward and stops in front of an obstacle. With no echo at all (nothing in range) it keeps driving.',
    },
  },
  {
    type: 'auto_follow_line',
    json: {
      type: 'auto_follow_line',
      message0: 'follow the line one step: left sensor %1 right sensor %2 at %3 %%',
      args0: [pinArg('digital', '2', 'LEFT'), pinArg('digital', '3', 'RIGHT'), valueIn('SPEED', 'Number')],
      ...STATEMENT,
      style: AUTO,
      tooltip: 'Put it in a forever loop. Two line sensors (HIGH on the line) either side of the line: it steers back towards the line, and searches the way it last saw it.',
    },
  },
  {
    type: 'auto_drive_cm',
    json: {
      type: 'auto_drive_cm',
      message0: 'drive straight %1 cm at %2 %% using the wheel encoders',
      args0: [valueIn('CM', 'Number'), valueIn('SPEED', 'Number')],
      ...STATEMENT,
      style: AUTO,
      tooltip: 'Needs the left and right wheel encoders set up (Basic Components). Keeps both wheels at the same count so the robot goes straight, then stops. Gives up after 15 seconds.',
    },
  },
  {
    type: 'auto_hold_speed',
    json: {
      type: 'auto_hold_speed',
      message0: 'hold both wheels at %1 RPM going %2 using the wheel encoders, at most %3 %% power',
      args0: [valueIn('RPM', 'Number'), dropdown('DIR', [['forward', 'FORWARD'], ['backward', 'BACKWARD']]), valueIn('MAX', 'Number')],
      ...STATEMENT,
      style: AUTO,
      tooltip:
        'Put it in a forever loop. Each wheel gets its own PI controller (proportional + integral) that measures the wheel speed with its encoder and sets the motor power, so both wheels keep the same speed on a slope, on carpet or with a weaker motor. Needs the left (A) and right (B) wheel encoders set up. The power never goes above the limit you give, even if a wheel is stuck.',
    },
  },
  {
    type: 'auto_turn_deg',
    json: {
      type: 'auto_turn_deg',
      message0: 'turn %1 %2 degrees at %3 %% using the wheel encoders, wheels %4 cm apart',
      args0: [dropdown('DIR', [['left', 'LEFT'], ['right', 'RIGHT']]), valueIn('DEG', 'Number'), valueIn('SPEED', 'Number'), valueIn('TRACK', 'Number')],
      ...STATEMENT,
      style: AUTO,
      tooltip: 'Spins on the spot by measuring how far each wheel turned. Needs the wheel encoders set up. Gives up after 10 seconds.',
    },
  },

  {
    type: 'tariro_motor_run',
    json: {
      type: 'tariro_motor_run',
      message0: 'motor %1 %2 at %3 %% speed',
      args0: [
        { type: 'field_dropdown', name: 'MOTOR', options: MOTOR_OPTIONS },
        { type: 'field_dropdown', name: 'DIRECTION', options: [['forward', 'FORWARD'], ['backward', 'BACKWARD']] },
        { type: 'input_value', name: 'SPEED', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'tariro_blocks',
      tooltip: 'Run a motor on the Tariro motor driver. Speed is 0 to 100 percent.',
    },
  },
  {
    type: 'tariro_motor_stop',
    json: {
      type: 'tariro_motor_stop',
      message0: 'stop motor %1',
      args0: [{ type: 'field_dropdown', name: 'MOTOR', options: [...MOTOR_OPTIONS, ['A and B', 'BOTH']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'tariro_blocks',
    },
  },
];

/** Two ways TB6612FNG boards are wired; the board definition's pin names select one. */
const WIRINGS = {
  /** One direction pin + one PWM enable per motor (second input inverted on the board), e.g. Malkon SMRS. */
  'direction-enable': {
    pins: ['INA', 'ENA', 'INB', 'ENB'],
    run: [
      "  uint8_t dir = motor == 'A' ? TARIRO_INA : TARIRO_INB;",
      "  uint8_t pwm = motor == 'A' ? TARIRO_ENA : TARIRO_ENB;",
      '  digitalWrite(dir, forward ? HIGH : LOW);',
      '  analogWrite(pwm, duty);',
    ],
    stop: ["  analogWrite(motor == 'A' ? TARIRO_ENA : TARIRO_ENB, 0);"],
  },
  /** Both direction inputs + PWM per motor (plain TB6612FNG breakout). */
  'two-input': {
    pins: ['PWMA', 'AIN1', 'AIN2', 'PWMB', 'BIN1', 'BIN2'],
    run: [
      "  uint8_t in1 = motor == 'A' ? TARIRO_AIN1 : TARIRO_BIN1;",
      "  uint8_t in2 = motor == 'A' ? TARIRO_AIN2 : TARIRO_BIN2;",
      "  uint8_t pwm = motor == 'A' ? TARIRO_PWMA : TARIRO_PWMB;",
      '  digitalWrite(in1, forward ? HIGH : LOW);',
      '  digitalWrite(in2, forward ? LOW : HIGH);',
      '  analogWrite(pwm, duty);',
    ],
    stop: [
      "  digitalWrite(motor == 'A' ? TARIRO_AIN1 : TARIRO_BIN1, LOW);",
      "  digitalWrite(motor == 'A' ? TARIRO_AIN2 : TARIRO_BIN2, LOW);",
      "  analogWrite(motor == 'A' ? TARIRO_PWMA : TARIRO_PWMB, 0);",
    ],
  },
} as const;

function motorSupport(ctx: EmitContext): boolean {
  const driver = ctx.board.onboard?.find((p) => p.kind === 'dual-motor-driver');
  if (!driver) {
    ctx.warn(`${ctx.board.name} has no onboard motor driver.`);
    return false;
  }
  const pins = driver.pins;
  const wiring = Object.values(WIRINGS).find((w) => w.pins.every((k) => pins[k] !== undefined));
  if (!wiring) {
    ctx.warn(`The ${ctx.board.name} motor driver definition does not list a complete set of pins.`);
    return false;
  }
  if (!driver.confirmed) {
    ctx.warn(`The ${ctx.board.name} motor pin numbers are placeholders until the board pinout is confirmed.`, 'program');
    ctx.contribute({
      section: 'includes',
      key: 'tariro:motor:warning',
      code: '#warning "Motor driver pin mapping is a placeholder and has not been confirmed."',
      priority: 0,
    });
  }
  ctx.contribute({
    section: 'globals',
    key: 'tariro:motor:pins',
    code: wiring.pins.map((k) => `const uint8_t TARIRO_${k} = ${pins[k]};`).join('\n'),
    priority: 10,
  });
  for (const k of wiring.pins)
    ctx.contribute({ section: 'setup.init', key: `pinMode:${pins[k]}`, code: `pinMode(TARIRO_${k}, OUTPUT);`, priority: 10 });
  ctx.contribute({
    section: 'functions',
    key: 'tariro:motor:fn',
    priority: 10,
    code: [
      "// Drive one channel of the TB6612FNG. motor: 'A' or 'B'; forward: direction; speedPercent: 0–100.",
      'void tariroMotor(char motor, bool forward, double speedPercent) {',
      '  int duty = constrain((int)(speedPercent * 255.0 / 100.0), 0, 255);',
      ...wiring.run,
      '}',
      '',
      'void tariroMotorStop(char motor) {',
      ...wiring.stop,
      '}',
    ].join('\n'),
  });
  return true;
}

const driveCode = (ctx: EmitContext, move: string, speed: string) => {
  const [lf, lk, rf, rk] = DRIVE_MOVES[move] ?? DRIVE_MOVES['FORWARD']!;
  const scaled = (k: number) => (k === 1 ? speed : `(${speed}) * ${k}`);
  return `tariroMotor('A', ${lf}, ${scaled(lk)});\ntariroMotor('B', ${rf}, ${scaled(rk)});`;
};

/** Gains of the speed-holding controller: % power per RPM of error, and per RPM·second of accumulated error. */
export const HOLD_SPEED_GAINS = { kp: 0.2, ki: 1.5 };

/**
 * The speed-holding controller (C++), one PI loop per wheel. Kept on its own so a test can compile it
 * against a simulated motor (extensions/test/hold-speed.test.ts).
 */
export const HOLD_SPEED_CPP = [
  '// Hold a wheel at a speed: PI control from the encoder\'s RPM to the motor\'s power (0 to maxPower %).',
  'struct TariroSpeedHold {',
  '  double integral;',
  '  unsigned long lastMillis;',
  '};',
  'TariroSpeedHold tariroHold[2] = {{0, 0}, {0, 0}};',
  '',
  'double tariroHoldPower(uint8_t i, double targetRpm, double maxPower) {',
  '  TariroSpeedHold &h = tariroHold[i];',
  '  unsigned long now = millis();',
  '  // First step, or the block was not used for a while: start afresh.',
  '  bool fresh = h.lastMillis == 0 || now - h.lastMillis > 500UL;',
  '  if (fresh) h.integral = 0;',
  '  double dt = fresh ? 0.0 : (now - h.lastMillis) / 1000.0;',
  '  h.lastMillis = now;',
  '  double error = fabs(targetRpm) - fabs(tariroEncoderTurnsPerSecond(i) * 60.0);',
  `  double kp = ${HOLD_SPEED_GAINS.kp}, ki = ${HOLD_SPEED_GAINS.ki};`,
  '  // Anti-windup: only add to the integral while the power is not at a limit (a stuck wheel cannot wind it up).',
  '  double trial = kp * error + ki * (h.integral + error * dt);',
  '  if (trial > 0.0 && trial < maxPower) h.integral += error * dt;',
  '  return constrain(kp * error + ki * h.integral, 0.0, maxPower);',
  '}',
].join('\n');

/** Helpers for the encoder-based moves: straight driving with a P correction, and turning. */
function autonomyHelpers(ctx: EmitContext): void {
  encoderRuntime(ctx);
  ctx.contribute({
    section: 'functions',
    key: 'auto:encoders',
    priority: 30,
    code: [
      '// Wheel distance in cm from an encoder (whichever way it turned).',
      'double tariroWheelCm(uint8_t i) { return fabs(tariroEncoderTurns(i) * tariroEncoderCircumference(i)); }',
      '',
      '// Drive straight: when one wheel gets ahead, slow it and speed up the other (P control).',
      'void tariroDriveCm(double cm, double speed) {',
      '  tariroEncoderReset(0);',
      '  tariroEncoderReset(1);',
      '  unsigned long start = millis();',
      '  while ((tariroWheelCm(0) + tariroWheelCm(1)) / 2.0 < cm && millis() - start < 15000UL) {',
      '    double error = tariroWheelCm(0) - tariroWheelCm(1);',
      '    tariroMotor(\'A\', true, constrain(speed - error * 8.0, 0.0, 100.0));',
      '    tariroMotor(\'B\', true, constrain(speed + error * 8.0, 0.0, 100.0));',
      '    delay(10);',
      '  }',
      '  tariroMotorStop(\'A\');',
      '  tariroMotorStop(\'B\');',
      '}',
      '',
      '// Spin on the spot: each wheel travels an arc of the circle the wheels make.',
      'void tariroTurnDeg(bool left, double degrees, double speed, double trackCm) {',
      '  double arc = 3.14159265 * trackCm * fabs(degrees) / 360.0;',
      '  tariroEncoderReset(0);',
      '  tariroEncoderReset(1);',
      '  unsigned long start = millis();',
      '  tariroMotor(\'A\', !left, speed);',
      '  tariroMotor(\'B\', left, speed);',
      '  while ((tariroWheelCm(0) + tariroWheelCm(1)) / 2.0 < arc && millis() - start < 10000UL) delay(5);',
      '  tariroMotorStop(\'A\');',
      '  tariroMotorStop(\'B\');',
      '}',
    ].join('\n'),
  });
}

const emitters: Record<string, Emitter> = {
  tariro_drive: {
    kind: 'statement',
    emit: (ctx) => {
      if (!motorSupport(ctx)) return '// (drive block skipped: no motor driver on this board)';
      return driveCode(ctx, ctx.field('MOVE'), ctx.value('SPEED', ORDER.MULTIPLICATIVE, '0'));
    },
  },
  auto_until_obstacle: {
    kind: 'statement',
    emit: (ctx) => {
      if (!motorSupport(ctx)) return '// (skipped: no motor driver on this board)';
      const [trig, echo] = [pinField(ctx, 'digital', 'TRIG'), pinField(ctx, 'digital', 'ECHO')];
      pinMode(ctx, trig, 'OUTPUT');
      pinMode(ctx, echo, 'INPUT');
      distanceHelper(ctx);
      const cm = ctx.value('CM', ORDER.RELATIONAL, '20');
      const speed = ctx.value('SPEED', ORDER.MULTIPLICATIVE, '50');
      // 0 means no echo (nothing in range): keep going.
      return [
        'while (true) {',
        `  double d = tariroDistanceCm(${trig}, ${echo});`,
        `  if (d > 0 && d < ${cm}) break;`,
        ...driveCode(ctx, 'FORWARD', speed).split('\n').map((l) => `  ${l}`),
        '  delay(30);',
        '}',
        "tariroMotorStop('A');",
        "tariroMotorStop('B');",
      ].join('\n');
    },
  },
  auto_follow_line: {
    kind: 'statement',
    emit: (ctx) => {
      if (!motorSupport(ctx)) return '// (skipped: no motor driver on this board)';
      const [l, r] = [pinField(ctx, 'digital', 'LEFT'), pinField(ctx, 'digital', 'RIGHT')];
      pinMode(ctx, l, 'INPUT');
      pinMode(ctx, r, 'INPUT');
      ctx.contribute({ section: 'globals', key: 'auto:line:last', code: '// Which side the line was last seen on (-1 left, 1 right).\nint tariroLineLast = 0;', priority: 30 });
      const speed = ctx.value('SPEED', ORDER.MULTIPLICATIVE, '40');
      const indent = (code: string) => code.split('\n').map((x) => `  ${x}`).join('\n');
      return [
        `bool onLeft = digitalRead(${l}) == HIGH;`,
        `bool onRight = digitalRead(${r}) == HIGH;`,
        'if (onLeft && onRight) {',
        indent(driveCode(ctx, 'FORWARD', speed)),
        '} else if (onLeft) {',
        '  tariroLineLast = -1;',
        indent(driveCode(ctx, 'LEFT', speed)),
        '} else if (onRight) {',
        '  tariroLineLast = 1;',
        indent(driveCode(ctx, 'RIGHT', speed)),
        '} else if (tariroLineLast < 0) {',
        indent(driveCode(ctx, 'SPIN_LEFT', `(${speed}) * 0.6`)),
        '} else {',
        indent(driveCode(ctx, 'SPIN_RIGHT', `(${speed}) * 0.6`)),
        '}',
      ].join('\n');
    },
  },
  auto_drive_cm: {
    kind: 'statement',
    emit: (ctx) => {
      if (!motorSupport(ctx)) return '// (skipped: no motor driver on this board)';
      autonomyHelpers(ctx);
      return `tariroDriveCm(${ctx.value('CM', ORDER.COMMA, '20')}, ${ctx.value('SPEED', ORDER.COMMA, '50')});`;
    },
  },
  auto_hold_speed: {
    kind: 'statement',
    emit: (ctx) => {
      if (!motorSupport(ctx)) return '// (skipped: no motor driver on this board)';
      encoderRuntime(ctx);
      ctx.contribute({ section: 'functions', key: 'auto:hold', priority: 31, code: HOLD_SPEED_CPP });
      const rpm = ctx.value('RPM', ORDER.COMMA, '60');
      const max = ctx.value('MAX', ORDER.RELATIONAL, '80');
      const forward = ctx.field('DIR') !== 'BACKWARD';
      const limit = `constrain(${max}, 0, 100)`;
      return [`tariroMotor('A', ${forward}, tariroHoldPower(0, ${rpm}, ${limit}));`, `tariroMotor('B', ${forward}, tariroHoldPower(1, ${rpm}, ${limit}));`].join('\n');
    },
  },
  auto_turn_deg: {
    kind: 'statement',
    emit: (ctx) => {
      if (!motorSupport(ctx)) return '// (skipped: no motor driver on this board)';
      autonomyHelpers(ctx);
      return `tariroTurnDeg(${ctx.field('DIR') === 'LEFT'}, ${ctx.value('DEG', ORDER.COMMA, '90')}, ${ctx.value('SPEED', ORDER.COMMA, '40')}, ${ctx.value('TRACK', ORDER.COMMA, '13')});`;
    },
  },
  tariro_motor_run: {
    kind: 'statement',
    emit: (ctx) => {
      if (!motorSupport(ctx)) return '// (motor block skipped: no motor driver on this board)';
      const motor = ctx.field('MOTOR') === 'B' ? 'B' : 'A';
      const forward = ctx.field('DIRECTION') === 'BACKWARD' ? 'false' : 'true';
      return `tariroMotor('${motor}', ${forward}, ${ctx.value('SPEED', ORDER.COMMA, '0')});`;
    },
  },
  tariro_motor_stop: {
    kind: 'statement',
    emit: (ctx) => {
      if (!motorSupport(ctx)) return '// (motor block skipped: no motor driver on this board)';
      const m = ctx.field('MOTOR');
      return m === 'BOTH' ? "tariroMotorStop('A');\ntariroMotorStop('B');" : `tariroMotorStop('${m === 'B' ? 'B' : 'A'}');`;
    },
  },
};

export const tariroBoardExtension: ExtensionManifest = {
  id: 'tariro-board',
  name: 'Tariro board',
  version: '0.1.0',
  category: 'robotics',
  description: 'Onboard peripherals of the Tariro board (dual motor driver).',
  boards: ['tariro'],
  blocks,
  emitters: { arduino: emitters },
  live: tariroLive,
  toolbox: [
    {
      id: 'tariro',
      name: 'Tariro',
      style: 'tariro_category',
      contents: [
        { kind: 'block', type: 'tariro_drive', inputs: { SPEED: num(60) } },
        { kind: 'block', type: 'tariro_motor_run', inputs: { SPEED: num(60) } },
        { kind: 'block', type: 'tariro_motor_stop' },
        { kind: 'label', text: 'Autonomy' },
        { kind: 'block', type: 'auto_until_obstacle', level: 'intermediate', inputs: { SPEED: num(50), CM: num(20) } },
        { kind: 'block', type: 'auto_follow_line', level: 'intermediate', inputs: { SPEED: num(40) } },
        { kind: 'block', type: 'auto_drive_cm', level: 'advanced', inputs: { CM: num(50), SPEED: num(50) } },
        { kind: 'block', type: 'auto_hold_speed', level: 'advanced', inputs: { RPM: num(60), MAX: num(80) } },
        { kind: 'block', type: 'auto_turn_deg', level: 'advanced', inputs: { DEG: num(90), SPEED: num(40), TRACK: num(13) } },
      ],
    },
  ],
};
