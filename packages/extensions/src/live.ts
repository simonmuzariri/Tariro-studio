/**
 * Live-mode handlers: what each block does when the program runs on the PC and drives the board
 * over Firmata. Blocks without a handler here (tone, serial input, the kit packs) need Upload.
 */
import { toNumber, type LiveContext, type LiveHandler, type LiveValue } from '@tariro-studio/core';

const statement = (run: (ctx: LiveContext) => Promise<void>): LiveHandler => ({ kind: 'statement', run });
const value = (run: (ctx: LiveContext) => Promise<LiveValue>): LiveHandler => ({ kind: 'value', run });

const compare = (op: string, a: LiveValue, b: LiveValue): boolean => {
  // Two texts compare as text; anything else compares as numbers (like the generated C++).
  const [x, y] = typeof a === 'string' && typeof b === 'string' ? [a, b] : [toNumber(a), toNumber(b)];
  switch (op) {
    case 'NEQ':
      return x !== y;
    case 'LT':
      return x < y;
    case 'LTE':
      return x <= y;
    case 'GT':
      return x > y;
    case 'GTE':
      return x >= y;
    default:
      return x === y;
  }
};

async function callArgs(ctx: LiveContext): Promise<LiveValue> {
  const st = ctx.extraState<{ name?: string; params?: string[] }>() ?? {};
  const args: LiveValue[] = [];
  for (let i = 0; i < (st.params?.length ?? 0); i++) args.push(await ctx.value(`ARG${i}`, 0));
  return ctx.call(st.name ?? '', args);
}

export const coreLive: Record<string, LiveHandler> = {
  tariro_forever: statement(async (ctx) => {
    while (await ctx.iterate('DO')) {
      /* runs until Stop or "break out" */
    }
  }),
  tariro_wait_seconds: statement(async (ctx) => ctx.wait((await ctx.number('SECONDS', 1)) * 1000)),
  tariro_wait_ms: statement(async (ctx) => ctx.wait(await ctx.number('MS', 0))),
  tariro_millis: value(async (ctx) => ctx.millis()),
  tariro_map: value(async (ctx) => {
    const [x, inLow, inHigh, outLow, outHigh] = [await ctx.number('VALUE'), await ctx.number('FROM_LOW'), await ctx.number('FROM_HIGH'), await ctx.number('TO_LOW'), await ctx.number('TO_HIGH')];
    return inHigh === inLow ? outLow : ((x - inLow) * (outHigh - outLow)) / (inHigh - inLow) + outLow;
  }),

  controls_if: statement(async (ctx) => {
    const st = ctx.extraState<{ elseIfCount?: number; hasElse?: boolean }>() ?? {};
    for (let i = 0; i <= (st.elseIfCount ?? 0); i++) if (await ctx.truthy(`IF${i}`)) return ctx.statements(`DO${i}`);
    if (st.hasElse) await ctx.statements('ELSE');
  }),
  controls_repeat_ext: statement(async (ctx) => {
    const times = Math.floor(await ctx.number('TIMES'));
    for (let i = 0; i < times; i++) if (!(await ctx.iterate('DO'))) break;
  }),
  controls_whileUntil: statement(async (ctx) => {
    const until = ctx.field('MODE') === 'UNTIL';
    while ((await ctx.truthy('BOOL')) !== until) if (!(await ctx.iterate('DO'))) break;
  }),
  controls_for: statement(async (ctx) => {
    const from = await ctx.number('FROM');
    const to = await ctx.number('TO');
    const step = Math.abs(await ctx.number('BY', 1)) || 1;
    const up = from <= to;
    for (let i = from; up ? i <= to : i >= to; i += up ? step : -step) {
      ctx.setVariable(i);
      if (!(await ctx.iterate('DO'))) break;
    }
  }),
  controls_flow_statements: statement(async (ctx) => ctx.flow(ctx.field('FLOW') === 'CONTINUE' ? 'CONTINUE' : 'BREAK')),

  logic_compare: value(async (ctx) => compare(ctx.field('OP'), await ctx.value('A', 0), await ctx.value('B', 0))),
  logic_operation: value(async (ctx) => {
    const and = ctx.field('OP') === 'AND';
    const a = await ctx.truthy('A', and);
    if (a !== and) return a; // short-circuit, like && and ||
    return ctx.truthy('B', and);
  }),
  logic_negate: value(async (ctx) => !(await ctx.truthy('BOOL'))),
  logic_boolean: value(async (ctx) => ctx.field('BOOL') === 'TRUE'),
  logic_ternary: value(async (ctx) => ((await ctx.truthy('IF')) ? ctx.value('THEN', 0) : ctx.value('ELSE', 0))),

  math_number: value(async (ctx) => toNumber(ctx.field('NUM'))),
  math_arithmetic: value(async (ctx) => {
    const a = await ctx.number('A');
    const b = await ctx.number('B', ctx.field('OP') === 'DIVIDE' ? 1 : 0);
    switch (ctx.field('OP')) {
      case 'MINUS':
        return a - b;
      case 'MULTIPLY':
        return a * b;
      case 'DIVIDE':
        if (b === 0) ctx.fail('The program tried to divide by zero.');
        return a / b;
      case 'POWER':
        return toNumber(Math.pow(a, b));
      default:
        return a + b;
    }
  }),
  math_single: value(async (ctx) => {
    const x = await ctx.number('NUM');
    const f: Record<string, (n: number) => number> = { ROOT: Math.sqrt, ABS: Math.abs, NEG: (n) => -n, LN: Math.log, LOG10: Math.log10, EXP: Math.exp, POW10: (n) => Math.pow(10, n) };
    return toNumber((f[ctx.field('OP')] ?? Math.sqrt)(x));
  }),
  math_round: value(async (ctx) => {
    const x = await ctx.number('NUM');
    const op = ctx.field('OP');
    return op === 'ROUNDUP' ? Math.ceil(x) : op === 'ROUNDDOWN' ? Math.floor(x) : Math.round(x);
  }),
  math_modulo: value(async (ctx) => {
    const d = await ctx.number('DIVISOR', 1);
    if (d === 0) ctx.fail('The program tried to divide by zero.');
    return (await ctx.number('DIVIDEND')) % d;
  }),
  math_constrain: value(async (ctx) => Math.min(Math.max(await ctx.number('VALUE'), await ctx.number('LOW')), await ctx.number('HIGH'))),
  math_random_int: value(async (ctx) => {
    const a = Math.floor(await ctx.number('FROM'));
    const b = Math.floor(await ctx.number('TO'));
    const [low, high] = a <= b ? [a, b] : [b, a];
    return low + Math.floor(Math.random() * (high - low + 1));
  }),
  math_change: statement(async (ctx) => ctx.setVariable(toNumber(ctx.getVariable()) + (await ctx.number('DELTA', 1)))),

  text: value(async (ctx) => ctx.field('TEXT')),
  text_join: value(async (ctx) => {
    const count = ctx.extraState<{ itemCount?: number }>()?.itemCount ?? 2;
    let out = '';
    for (let i = 0; i < count; i++) if (ctx.hasInput(`ADD${i}`)) out += await ctx.text(`ADD${i}`);
    return out;
  }),
  text_length: value(async (ctx) => (await ctx.text('VALUE')).length),

  variables_get: value(async (ctx) => ctx.getVariable()),
  variables_set: statement(async (ctx) => ctx.setVariable(await ctx.value('VALUE', 0))),

  procedures_callnoreturn: statement(async (ctx) => {
    await callArgs(ctx);
  }),
  procedures_callreturn: value(callArgs),
  procedures_ifreturn: statement(async (ctx) => {
    if (!ctx.inProcedure) ctx.fail('"if return" can only be used inside a function.');
    if (await ctx.truthy('CONDITION')) ctx.returnValue(ctx.hasInput('VALUE') ? await ctx.value('VALUE', 0) : undefined);
  }),
};

const analogChannel = (ctx: LiveContext): number => {
  const m = /^A(\d+)$/.exec(ctx.field('PIN'));
  if (!m) ctx.fail(`Pin ${ctx.field('PIN')} is not an analog pin.`);
  return Number(m[1]);
};

export const ioLive: Record<string, LiveHandler> = {
  io_digital_write: statement(async (ctx) => ctx.io.digitalWrite(await ctx.pin(), ctx.field('STATE') !== 'LOW')),
  io_digital_read: value(async (ctx) => ctx.io.digitalRead(await ctx.pin(), ctx.field('PULL') === 'INPUT_PULLUP')),
  io_analog_read: value(async (ctx) => ctx.io.analogRead(analogChannel(ctx))),
  io_pwm_write: statement(async (ctx) => ctx.io.analogWrite(await ctx.pin(), await ctx.number('VALUE'))),
  serial_print: statement(async (ctx) => ctx.print((await ctx.text('VALUE')) + (ctx.field('MODE') === 'print' ? '' : '\n'))),
};

// ───────────────────────── Tariro motors ─────────────────────────

type Pins = Record<string, number>;
function motorPins(ctx: LiveContext): Pins {
  const driver = ctx.board.onboard?.find((p) => p.kind === 'dual-motor-driver');
  if (!driver) ctx.fail(`${ctx.board.name} has no onboard motor driver.`);
  return driver.pins;
}

async function motorRun(ctx: LiveContext, pins: Pins, motor: 'A' | 'B', forward: boolean, percent: number): Promise<void> {
  const duty = Math.min(Math.max(Math.trunc((percent * 255) / 100), 0), 255);
  if (pins['INA'] !== undefined) {
    // One direction pin and one PWM enable per motor (Malkon SMRS).
    await ctx.io.digitalWrite(pins[`IN${motor}`]!, forward);
    await ctx.io.analogWrite(pins[`EN${motor}`]!, duty);
  } else if (pins['AIN1'] !== undefined) {
    await ctx.io.digitalWrite(pins[`${motor}IN1`]!, forward);
    await ctx.io.digitalWrite(pins[`${motor}IN2`]!, !forward);
    await ctx.io.analogWrite(pins[`PWM${motor}`]!, duty);
  } else ctx.fail(`The ${ctx.board.name} motor driver definition does not list a complete set of pins.`);
}

async function motorStop(ctx: LiveContext, pins: Pins, motor: 'A' | 'B'): Promise<void> {
  if (pins['INA'] !== undefined) await ctx.io.analogWrite(pins[`EN${motor}`]!, 0);
  else if (pins['AIN1'] !== undefined) {
    await ctx.io.digitalWrite(pins[`${motor}IN1`]!, false);
    await ctx.io.digitalWrite(pins[`${motor}IN2`]!, false);
    await ctx.io.analogWrite(pins[`PWM${motor}`]!, 0);
  }
}

/** Drive moves for the two Tariro motors (A left, B right): [left forward?, left share, right forward?, right share]. */
export const DRIVE_MOVES: Record<string, [boolean, number, boolean, number]> = {
  FORWARD: [true, 1, true, 1],
  BACKWARD: [false, 1, false, 1],
  LEFT: [true, 0.4, true, 1],
  RIGHT: [true, 1, true, 0.4],
  SPIN_LEFT: [false, 1, true, 1],
  SPIN_RIGHT: [true, 1, false, 1],
};
export const tariroLive: Record<string, LiveHandler> = {
  tariro_drive: statement(async (ctx) => {
    const pins = motorPins(ctx);
    const [lf, lk, rf, rk] = DRIVE_MOVES[ctx.field('MOVE')] ?? DRIVE_MOVES['FORWARD']!;
    const speed = await ctx.number('SPEED');
    await motorRun(ctx, pins, 'A', lf, speed * lk);
    await motorRun(ctx, pins, 'B', rf, speed * rk);
  }),
  tariro_motor_run: statement(async (ctx) => motorRun(ctx, motorPins(ctx), ctx.field('MOTOR') === 'B' ? 'B' : 'A', ctx.field('DIRECTION') !== 'BACKWARD', await ctx.number('SPEED'))),
  tariro_motor_stop: statement(async (ctx) => {
    const pins = motorPins(ctx);
    const m = ctx.field('MOTOR');
    for (const motor of m === 'BOTH' ? (['A', 'B'] as const) : [m === 'B' ? ('B' as const) : ('A' as const)]) await motorStop(ctx, pins, motor);
  }),
};

// ───────────────────────── Basic Components, sensors and simple outputs ─────────────────────────

/** Detector modules: the level their output has when they detect something (same table as the C++ emitters). */
export const DETECTOR_ACTIVE: Record<string, 'HIGH' | 'LOW'> = { IR: 'LOW', PIR: 'HIGH', SOUND: 'HIGH', RAIN: 'LOW', TOUCH: 'HIGH', LINE: 'HIGH' };
export const TRAFFIC_LIGHTS: Record<string, [boolean, boolean, boolean]> = {
  RED: [true, false, false],
  YELLOW: [false, true, false],
  GREEN: [false, false, true],
  RED_YELLOW: [true, true, false],
  OFF: [false, false, false],
};

export const basicLive: Record<string, LiveHandler> = {
  basic_led: statement(async (ctx) => ctx.io.digitalWrite(await ctx.pin(), ctx.field('STATE') !== 'OFF')),
  basic_led_brightness: statement(async (ctx) => ctx.io.analogWrite(await ctx.pin(), Math.min(Math.max(Math.trunc(((await ctx.number('LEVEL')) * 255) / 100), 0), 255))),
  basic_buzzer: statement(async (ctx) => ctx.io.digitalWrite(await ctx.pin(), ctx.field('STATE') !== 'OFF')),
  // Wired to GND with the pull-up on: closed reads LOW.
  basic_switch: value(async (ctx) => (await ctx.io.digitalRead(await ctx.pin(), true)) === (ctx.field('STATE') === 'OPEN')),
};

export const sensorsLive: Record<string, LiveHandler> = {
  sensor_button_pressed: value(async (ctx) => !(await ctx.io.digitalRead(await ctx.pin(), true))),
  // Arduino's map() works in whole numbers; do the same so both modes print the same values.
  sensor_analog_level: value(async (ctx) => Math.trunc(((await ctx.io.analogRead(analogChannel(ctx))) * 100) / 1023)),
  sensor_detect: value(async (ctx) => (await ctx.io.digitalRead(await ctx.pin(), false)) === ((DETECTOR_ACTIVE[ctx.field('SENSOR')] ?? 'HIGH') === 'HIGH')),
};

export const outputsLive: Record<string, LiveHandler> = {
  act_traffic_light: statement(async (ctx) => {
    const states = TRAFFIC_LIGHTS[ctx.field('LIGHT')] ?? TRAFFIC_LIGHTS['OFF']!;
    for (const [i, field] of ['RED', 'YELLOW', 'GREEN'].entries()) await ctx.io.digitalWrite(await ctx.pin(field), states[i]!);
  }),
  act_rgb_led: statement(async (ctx) => {
    for (const [field, input] of [['R', 'RV'], ['G', 'GV'], ['B', 'BV']] as const) await ctx.io.analogWrite(await ctx.pin(field), Math.min(Math.max(Math.trunc(await ctx.number(input)), 0), 255));
  }),
  act_relay: statement(async (ctx) => {
    const activeLow = ctx.field('ACTIVE') !== 'HIGH';
    await ctx.io.digitalWrite(await ctx.pin(), (ctx.field('STATE') !== 'OFF') !== activeLow);
  }),
};

// ───────────────────────── Actuators (Phase 3b) ─────────────────────────
// Same behaviour as the generated C++ (actuators.ts): the same limits, step timing and defaults.

const clamp = (v: number, low: number, high: number) => Math.min(Math.max(v, low), high);
/** A dropdown that holds an array index, kept inside 0…max. */
const indexField = (ctx: LiveContext, field: string, max: number) => clamp(Math.trunc(Number(ctx.field(field)) || 0), 0, max);

/** Last angle sent to each servo pin (a servo cannot report where it is). Starts at 90, like the C++. */
const servoAngles = (ctx: LiveContext) => ctx.memory('servo:angles', () => new Map<number, number>());

/** Move a servo to `target` in steps 20 ms apart, as tariroServoMove does. */
async function servoMove(ctx: LiveContext, pin: number, target: number, seconds: number): Promise<void> {
  const angles = servoAngles(ctx);
  const start = angles.get(pin) ?? 90;
  const goal = clamp(target, 0, 180);
  const steps = seconds <= 0 ? 0 : Math.trunc(seconds * 50);
  for (let i = 1; i <= steps; i++) {
    await ctx.io.servoWrite(pin, Math.trunc(start + ((goal - start) * i) / steps));
    await ctx.wait(20);
  }
  await ctx.io.servoWrite(pin, Math.trunc(goal));
  angles.set(pin, goal);
}

interface DcMotor {
  in1: number;
  in2: number;
  en: number;
}
const dcMotors = (ctx: LiveContext) => ctx.memory('dc:motors', () => new Map<number, DcMotor>());

async function dcRun(ctx: LiveContext, i: number, forward: boolean, percent: number): Promise<void> {
  const m = dcMotors(ctx).get(i);
  if (!m) return; // a motor that was not set up is left alone, as in the C++
  await ctx.io.digitalWrite(m.in1, forward);
  await ctx.io.digitalWrite(m.in2, !forward);
  await ctx.io.analogWrite(m.en, clamp(Math.trunc((percent * 255) / 100), 0, 255));
}

async function dcStop(ctx: LiveContext, i: number, brake: boolean): Promise<void> {
  const m = dcMotors(ctx).get(i);
  if (!m) return;
  await ctx.io.digitalWrite(m.in1, brake);
  await ctx.io.digitalWrite(m.in2, brake);
  await ctx.io.analogWrite(m.en, brake ? 255 : 0);
}

const DRIVE: Record<string, [boolean, number, boolean, number]> = {
  FORWARD: [true, 1, true, 1],
  BACKWARD: [false, 1, false, 1],
  LEFT: [true, 0.4, true, 1],
  RIGHT: [true, 1, true, 0.4],
  SPIN_LEFT: [false, 1, true, 1],
  SPIN_RIGHT: [true, 1, false, 1],
};

interface ArmJoint {
  pin: number;
  min: number;
  max: number;
  home: number;
  angle: number;
}
interface Arm {
  joints: Array<ArmJoint | undefined>;
  target: number[];
  speed: number;
}
const arm = (ctx: LiveContext) => ctx.memory<Arm>('arm', () => ({ joints: [], target: [90, 90, 90, 90, 90], speed: 60 }));

/** Move the joints in `mask` together so they arrive at the same moment (tariroArmGo). */
async function armGo(ctx: LiveContext, mask: number): Promise<void> {
  const a = arm(ctx);
  const moving = a.joints.flatMap((j, i) => (j && mask & (1 << i) ? [i] : []));
  const start = a.joints.map((j) => j?.angle ?? 0);
  let furthest = 0;
  for (const i of moving) {
    const j = a.joints[i]!;
    a.target[i] = clamp(a.target[i]!, j.min, j.max);
    furthest = Math.max(furthest, Math.abs(a.target[i]! - j.angle));
  }
  const steps = Math.trunc((furthest / a.speed) * 50);
  for (let n = 1; n <= steps; n++) {
    for (const i of moving) await ctx.io.servoWrite(a.joints[i]!.pin, Math.trunc(start[i]! + ((a.target[i]! - start[i]!) * n) / steps));
    await ctx.wait(20);
  }
  for (const i of moving) {
    await ctx.io.servoWrite(a.joints[i]!.pin, Math.trunc(a.target[i]!));
    a.joints[i]!.angle = a.target[i]!;
  }
}

/** Segments a–g for digits 0–9 (bit 0 = a), as in the C++ helper. */
const SEVEN_SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
const sevenSeg = (ctx: LiveContext) => ctx.memory('7seg', () => ({ first: 2, anode: false }));

export const actuatorsLive: Record<string, LiveHandler> = {
  ...outputsLive,
  act_servo: statement(async (ctx) => {
    const pin = await ctx.pin();
    const angle = clamp(await ctx.number('ANGLE', 90), 0, 180);
    servoAngles(ctx).set(pin, angle);
    await ctx.io.servoWrite(pin, Math.trunc(angle));
  }),
  act_servo_move: statement(async (ctx) => servoMove(ctx, await ctx.pin(), await ctx.number('ANGLE', 90), await ctx.number('SECONDS', 1))),
  act_servo_sweep: statement(async (ctx) => {
    const pin = await ctx.pin();
    const [from, to, secs] = [await ctx.number('FROM', 0), await ctx.number('TO', 180), await ctx.number('SECONDS', 1)];
    await servoMove(ctx, pin, from, 0);
    await servoMove(ctx, pin, to, secs);
    await servoMove(ctx, pin, from, secs);
  }),

  act_dc_setup: statement(async (ctx) => {
    const m = { in1: await ctx.pin('IN1'), in2: await ctx.pin('IN2'), en: await ctx.pin('EN') };
    dcMotors(ctx).set(indexField(ctx, 'MOTOR', 3), m);
    await ctx.io.digitalWrite(m.in1, false);
    await ctx.io.digitalWrite(m.in2, false);
    await ctx.io.analogWrite(m.en, 0);
  }),
  act_dc_run: statement(async (ctx) => dcRun(ctx, indexField(ctx, 'MOTOR', 3), ctx.field('DIRECTION') !== 'BACKWARD', await ctx.number('SPEED'))),
  act_dc_stop: statement(async (ctx) => {
    const brake = ctx.field('HOW') === 'BRAKE';
    for (const i of ctx.field('MOTOR') === 'ALL' ? [0, 1, 2, 3] : [indexField(ctx, 'MOTOR', 3)]) await dcStop(ctx, i, brake);
  }),
  act_dc_drive: statement(async (ctx) => {
    const speed = await ctx.number('SPEED');
    const [lf, lk, rf, rk] = DRIVE[ctx.field('MOVE')] ?? DRIVE['FORWARD']!;
    await dcRun(ctx, 0, lf, speed * lk);
    await dcRun(ctx, 1, rf, speed * rk);
  }),

  arm_joint_setup: statement(async (ctx) => {
    const i = indexField(ctx, 'JOINT', 4);
    const [lo, hi] = [await ctx.number('MIN', 0), await ctx.number('MAX', 180)];
    const min = clamp(Math.min(lo, hi), 0, 180);
    const max = clamp(Math.max(lo, hi), 0, 180);
    const home = clamp(await ctx.number('HOME', 90), min, max);
    const a = arm(ctx);
    a.joints[i] = { pin: await ctx.pin(), min, max, home, angle: home };
    a.target[i] = home;
    await ctx.io.servoWrite(a.joints[i].pin, Math.trunc(home));
  }),
  arm_speed: statement(async (ctx) => {
    arm(ctx).speed = clamp(await ctx.number('SPEED', 60), 5, 360);
  }),
  arm_joint_move: statement(async (ctx) => {
    const i = indexField(ctx, 'JOINT', 4);
    arm(ctx).target[i] = await ctx.number('ANGLE', 90);
    await armGo(ctx, 1 << i);
  }),
  arm_pose: statement(async (ctx) => {
    const a = arm(ctx);
    for (const [i, k] of ['BASE', 'SHOULDER', 'ELBOW', 'WRIST'].entries()) a.target[i] = await ctx.number(k, 90);
    await armGo(ctx, 0x0f);
  }),
  arm_home: statement(async (ctx) => {
    const a = arm(ctx);
    a.joints.forEach((j, i) => j && (a.target[i] = j.home));
    await armGo(ctx, 0x1f);
  }),
  arm_gripper: statement(async (ctx) => {
    const a = arm(ctx);
    const g = a.joints[4];
    if (g) a.target[4] = ctx.field('ACTION') === 'CLOSE' ? g.min : g.max;
    await armGo(ctx, 1 << 4);
  }),
  arm_joint_angle: value(async (ctx) => arm(ctx).joints[indexField(ctx, 'JOINT', 4)]?.angle ?? 0),

  act_seven_segment_setup: statement(async (ctx) => {
    const cfg = sevenSeg(ctx);
    cfg.first = Number(ctx.field('FIRST')) || 2;
    cfg.anode = ctx.field('KIND') === 'CA';
  }),
  act_seven_segment_show: statement(async (ctx) => {
    const cfg = sevenSeg(ctx);
    const v = await ctx.number('DIGIT', 0);
    const bits = Number.isInteger(v) && v >= 0 && v <= 9 ? SEVEN_SEG[v]! : 0;
    for (let i = 0; i < 7; i++) await ctx.io.digitalWrite(cfg.first + i, Boolean(bits & (1 << i)) !== cfg.anode);
  }),
};

export const pidLive: Record<string, LiveHandler> = {
  // One PID step per evaluation, with state per block, limits ±100 (same as tariroPid in the C++).
  basic_pid: value(async (ctx) => {
    const s = ctx.memory(`pid:${ctx.blockId}`, () => ({ integral: 0, previous: 0, last: undefined as number | undefined }));
    const [target, measured, kp, ki, kd] = [await ctx.number('TARGET'), await ctx.number('MEASURED'), await ctx.number('KP'), await ctx.number('KI'), await ctx.number('KD')];
    const now = ctx.millis();
    const dt = s.last === undefined ? 0 : (now - s.last) / 1000;
    s.last = now;
    const error = target - measured;
    let derivative = 0;
    if (dt > 0) {
      s.integral = clamp(s.integral + error * dt, -100, 100);
      derivative = (error - s.previous) / dt;
    }
    s.previous = error;
    return clamp(kp * error + ki * s.integral + kd * derivative, -100, 100);
  }),
};
