/**
 * MicroPython emitters for the Basic Components, sensors and Actuators packs (Phase 3b), ESP32 only.
 * Each helper mirrors the C++ runtime of the same block (basic.ts, sensors.ts, actuators.ts): the
 * same limits, step timing and defaults, so a program behaves the same in either language.
 *
 * Not here (the IDE says "not available in MicroPython yet"): colour sensor, MPU-6050.
 */
import { PY, type EmitContext, type Emitter } from '@tariro-studio/core';
import { gpio, helper, imp, pinObject, pwmObject } from './micropython.js';
import { DETECTOR_ACTIVE, TRAFFIC_LIGHTS } from './live.js';

type V = Extract<Emitter, { kind: 'value' }>;
const value = (type: V['type'], emit: V['emit']): Emitter => ({ kind: 'value', type, emit });
const statement = (emit: (ctx: EmitContext) => string): Emitter => ({ kind: 'statement', emit });
const lines = (...l: string[]) => l.join('\n');
const index = (ctx: EmitContext, field: string, max: number): number => Math.min(Math.max(Math.trunc(Number(ctx.field(field)) || 0), 0), max);
const global = (ctx: EmitContext, key: string, code: string) => ctx.contribute({ section: 'globals', key, code, priority: 20 });

/** ADC on a pin with the full 0–3.3 V range; `read()` returns 0–4095. */
function adc(ctx: EmitContext, field = 'PIN'): string {
  imp(ctx, 'from machine import Pin, ADC');
  const n = gpio(ctx, field);
  global(ctx, `adc:${n}`, `adc${n} = ADC(Pin(${n}))\nadc${n}.atten(ADC.ATTN_11DB)`);
  return `adc${n}`;
}

/** 0–100 % as a 10-bit PWM duty (ESP32 MicroPython). */
function percentDuty(ctx: EmitContext, input: string): string {
  return `int(min(max(${ctx.value(input, PY.NONE, '0')}, 0), 100) * 1023 / 100)`;
}

// ───────────────────────── Basic Components ─────────────────────────

const ENCODER_INDEX: Record<string, number> = { LEFT: 0, RIGHT: 1, E1: 2, E2: 3 };
const encoderIndex = (ctx: EmitContext, field = 'ENCODER') => ENCODER_INDEX[ctx.field(field)] ?? 0;

function encoderRuntime(ctx: EmitContext): void {
  imp(ctx, 'import time');
  imp(ctx, 'from machine import Pin');
  global(
    ctx,
    'enc:state',
    lines(
      '# Rotary encoders: 0 = left wheel, 1 = right wheel, 2 = encoder 1, 3 = encoder 2.',
      '# Defaults: 20 pulses per turn, 65 mm wheel. Counts change inside pin interrupts.',
      'tariro_encoders = [{"a": None, "b": None, "quad": False, "count": 0, "per_turn": 20.0, "wheel_mm": 65.0, "last_count": 0, "last_us": 0, "tps": 0.0} for _ in range(4)]',
    ),
  );
  helper(
    ctx,
    'enc:fn',
    lines(
      'def tariro_encoder_begin(i, pin_a, pin_b, quadrature):',
      '    # Quadrature counts both edges of A (2 counts per pulse); single channel counts rising edges.',
      '    e = tariro_encoders[i]',
      '    e["per_turn"] = e["per_turn"] / (2.0 if e["quad"] else 1.0) * (2.0 if quadrature else 1.0)',
      '    e["quad"] = quadrature',
      '    e["a"] = Pin(pin_a, Pin.IN, Pin.PULL_UP)',
      '    e["b"] = Pin(pin_b, Pin.IN, Pin.PULL_UP) if quadrature else None',
      '    def tick(_pin):',
      '        # With two channels, B tells which way the shaft turned.',
      '        if e["quad"] and e["a"].value() == e["b"].value():',
      '            e["count"] -= 1',
      '        else:',
      '            e["count"] += 1',
      '    e["a"].irq(trigger=(Pin.IRQ_RISING | Pin.IRQ_FALLING) if quadrature else Pin.IRQ_RISING, handler=tick)',
      '    e["last_us"] = time.ticks_us()',
      '',
      'def tariro_encoder_resolution(i, pulses_per_turn, gear_ratio, wheel_mm):',
      '    e = tariro_encoders[i]',
      '    if pulses_per_turn > 0 and gear_ratio > 0:',
      '        e["per_turn"] = pulses_per_turn * gear_ratio * (2.0 if e["quad"] else 1.0)',
      '    if wheel_mm > 0:',
      '        e["wheel_mm"] = wheel_mm',
      '',
      'def tariro_encoder_reset(i):',
      '    e = tariro_encoders[i]',
      '    e["count"] = 0',
      '    e["last_count"] = 0',
      '    e["tps"] = 0.0',
      '    e["last_us"] = time.ticks_us()',
      '',
      'def tariro_encoder_turns(i):',
      '    return tariro_encoders[i]["count"] / tariro_encoders[i]["per_turn"]',
      '',
      'def tariro_encoder_tps(i):',
      '    # Turns per second from the counts since the last measurement (at least 50 ms earlier).',
      '    e = tariro_encoders[i]',
      '    now = time.ticks_us()',
      '    elapsed = time.ticks_diff(now, e["last_us"])',
      '    if elapsed >= 50000:',
      '        c = e["count"]',
      '        e["tps"] = (c - e["last_count"]) / e["per_turn"] * 1000000 / elapsed',
      '        e["last_count"] = c',
      '        e["last_us"] = now',
      '    return e["tps"]',
      '',
      'def tariro_encoder_circumference(i):',
      '    # Wheel circumference in cm.',
      '    return tariro_encoders[i]["wheel_mm"] * 3.14159265 / 10',
    ),
  );
}

function reading(ctx: EmitContext, i: number, what: string): [string, number] {
  encoderRuntime(ctx);
  switch (what) {
    case 'TURNS':
      return [`tariro_encoder_turns(${i})`, PY.POSTFIX];
    case 'ANGLE':
      return [`tariro_encoder_turns(${i}) * 360`, PY.MULTIPLICATIVE];
    case 'DIRECTION':
      return [`(tariro_encoder_tps(${i}) > 0) - (tariro_encoder_tps(${i}) < 0)`, PY.ADDITIVE];
    case 'RPM':
      return [`tariro_encoder_tps(${i}) * 60`, PY.MULTIPLICATIVE];
    case 'DEG_PER_S':
      return [`tariro_encoder_tps(${i}) * 360`, PY.MULTIPLICATIVE];
    case 'DISTANCE':
      return [`tariro_encoder_turns(${i}) * tariro_encoder_circumference(${i})`, PY.MULTIPLICATIVE];
    case 'CM_PER_S':
      return [`tariro_encoder_tps(${i}) * tariro_encoder_circumference(${i})`, PY.MULTIPLICATIVE];
    default:
      return [`tariro_encoders[${i}]["count"]`, PY.POSTFIX];
  }
}

export const basicMicroPython: Record<string, Emitter> = {
  basic_led: statement((ctx) => `${pinObject(ctx, gpio(ctx), 'OUT')}.value(${ctx.field('STATE') === 'OFF' ? 0 : 1})`),
  basic_led_brightness: statement((ctx) => `${pwmObject(ctx, gpio(ctx))}.duty(${percentDuty(ctx, 'LEVEL')})`),
  basic_buzzer: statement((ctx) => `${pinObject(ctx, gpio(ctx), 'OUT')}.value(${ctx.field('STATE') === 'OFF' ? 0 : 1})`),
  // Wired to GND with the pull-up on: closed reads 0.
  basic_switch: value('boolean', (ctx) => [`${pinObject(ctx, gpio(ctx), 'IN_PULLUP')}.value() == ${ctx.field('STATE') === 'OPEN' ? 1 : 0}`, PY.COMPARISON]),

  enc_setup: statement((ctx) => {
    encoderRuntime(ctx);
    const a = gpio(ctx, 'PIN_A');
    const quad = ctx.field('KIND') !== 'SINGLE';
    const b = quad ? gpio(ctx, 'PIN_B') : a;
    if (quad && a === b) ctx.warn('A quadrature encoder needs two different pins for A and B.');
    return `tariro_encoder_begin(${encoderIndex(ctx)}, ${a}, ${b}, ${quad ? 'True' : 'False'})`;
  }),
  enc_config: statement((ctx) => {
    encoderRuntime(ctx);
    return `tariro_encoder_resolution(${encoderIndex(ctx)}, ${ctx.value('PPR', PY.NONE, '20')}, ${ctx.value('GEAR', PY.NONE, '1')}, ${ctx.value('DIAMETER', PY.NONE, '65')})`;
  }),
  enc_read: value('number', (ctx) => reading(ctx, encoderIndex(ctx), ctx.field('WHAT'))),
  enc_reset: statement((ctx) => {
    encoderRuntime(ctx);
    if (ctx.field('ENCODER') === 'ALL') return 'for i in range(4):\n    tariro_encoder_reset(i)';
    return `tariro_encoder_reset(${encoderIndex(ctx)})`;
  }),
  enc_compare: value('number', (ctx) => {
    const what = ctx.field('WHAT');
    const [a] = reading(ctx, encoderIndex(ctx, 'A'), what);
    const [b] = reading(ctx, encoderIndex(ctx, 'B'), what);
    return [`(${a}) - (${b})`, PY.ADDITIVE];
  }),
  enc_absolute_analog: value('number', (ctx) => [`${adc(ctx)}.read() * 360 / 4095`, PY.MULTIPLICATIVE]),
  enc_as5600: value('number', (ctx) => {
    imp(ctx, 'from machine import Pin, I2C');
    const bus = ctx.board.pins.i2c;
    if (!bus) {
      ctx.warn(`${ctx.board.name} has no I²C pins listed.`);
      return ['-1', PY.UNARY];
    }
    global(ctx, 'i2c:0', `i2c = I2C(0, sda=Pin(${bus.sda}), scl=Pin(${bus.scl}), freq=400000)`);
    helper(
      ctx,
      'enc:as5600',
      lines(
        'def tariro_as5600_angle():',
        '    # AS5600 magnetic encoder: 12-bit angle in registers 0x0E (high) and 0x0F (low). -1 if it does not answer.',
        '    try:',
        '        hi, lo = i2c.readfrom_mem(0x36, 0x0E, 2)',
        '    except OSError:',
        '        return -1',
        '    return (((hi & 0x0F) << 8) | lo) * 360 / 4096',
      ),
    );
    return ['tariro_as5600_angle()', PY.POSTFIX];
  }),
  basic_pid: value('number', (ctx) => {
    imp(ctx, 'import time');
    const state = ctx.temp('pid');
    global(ctx, `pid:${state}`, `${state} = {"integral": 0.0, "previous": 0.0, "last": None}`);
    helper(
      ctx,
      'pid:fn',
      lines(
        'def tariro_pid(s, target, measured, kp, ki, kd):',
        '    # One PID step. The output and the integral are limited to +-100 so a stalled motor cannot wind it up.',
        '    now = time.ticks_ms()',
        '    dt = 0.0 if s["last"] is None else time.ticks_diff(now, s["last"]) / 1000',
        '    s["last"] = now',
        '    error = target - measured',
        '    derivative = 0.0',
        '    if dt > 0:',
        '        s["integral"] = min(max(s["integral"] + error * dt, -100), 100)',
        '        derivative = (error - s["previous"]) / dt',
        '    s["previous"] = error',
        '    return min(max(kp * error + ki * s["integral"] + kd * derivative, -100), 100)',
      ),
    );
    const args = ['TARGET', 'MEASURED', 'KP', 'KI', 'KD'].map((k) => ctx.value(k, PY.NONE, '0')).join(', ');
    return [`tariro_pid(${state}, ${args})`, PY.POSTFIX];
  }),
};

// ───────────────────────── Sensors ─────────────────────────

export const sensorsMicroPython: Record<string, Emitter> = {
  sensor_button_pressed: value('boolean', (ctx) => [`${pinObject(ctx, gpio(ctx), 'IN_PULLUP')}.value() == 0`, PY.COMPARISON]),
  // Whole-number percent, like Arduino's map(); the ESP32 ADC reads 0–4095.
  sensor_analog_level: value('number', (ctx) => [`${adc(ctx)}.read() * 100 // 4095`, PY.MULTIPLICATIVE]),
  sensor_detect: value('boolean', (ctx) => [
    `${pinObject(ctx, gpio(ctx), 'IN')}.value() == ${(DETECTOR_ACTIVE[ctx.field('SENSOR')] ?? 'HIGH') === 'HIGH' ? 1 : 0}`,
    PY.COMPARISON,
  ]),
  sensor_ultrasonic_cm: value('number', (ctx) => {
    imp(ctx, 'import time');
    imp(ctx, 'from machine import Pin, time_pulse_us');
    helper(
      ctx,
      'sensor:ultrasonic',
      lines(
        'def tariro_distance_cm(trig, echo):',
        '    # HC-SR04: 10 us trigger pulse, echo time -> distance (sound travels ~0.0343 cm/us, there and back).',
        '    trig_pin = Pin(trig, Pin.OUT)',
        '    echo_pin = Pin(echo, Pin.IN)',
        '    trig_pin.value(0)',
        '    time.sleep_us(2)',
        '    trig_pin.value(1)',
        '    time.sleep_us(10)',
        '    trig_pin.value(0)',
        '    us = time_pulse_us(echo_pin, 1, 30000)',
        '    return 0 if us < 0 else us * 0.0343 / 2',
      ),
    );
    return [`tariro_distance_cm(${gpio(ctx, 'TRIG')}, ${gpio(ctx, 'ECHO')})`, PY.POSTFIX];
  }),
  sensor_dht: value('number', (ctx) => {
    imp(ctx, 'import dht');
    imp(ctx, 'import time');
    imp(ctx, 'from machine import Pin');
    const n = gpio(ctx);
    const model = ctx.field('MODEL') === 'DHT11' ? 'DHT11' : 'DHT22';
    global(ctx, `dht:${n}`, `dht${n} = {"sensor": dht.${model}(Pin(${n})), "last": None, "temp": 0.0, "hum": 0.0}`);
    helper(
      ctx,
      'sensor:dht',
      lines(
        'def tariro_dht(d, humidity):',
        '    # The sensor can only be read every 2 s; in between, give the last reading.',
        '    now = time.ticks_ms()',
        '    if d["last"] is None or time.ticks_diff(now, d["last"]) >= 2000:',
        '        try:',
        '            d["sensor"].measure()',
        '            d["temp"] = d["sensor"].temperature()',
        '            d["hum"] = d["sensor"].humidity()',
        '        except OSError:',
        '            pass  # keep the last good reading',
        '        d["last"] = now',
        '    return d["hum"] if humidity else d["temp"]',
      ),
    );
    return [`tariro_dht(dht${n}, ${ctx.field('READING') === 'HUM' ? 'True' : 'False'})`, PY.POSTFIX];
  }),
};

// ───────────────────────── Actuators ─────────────────────────

/** A 50 Hz servo PWM on the block's pin, and its last angle (a servo cannot report where it is). */
function servoInstance(ctx: EmitContext, field = 'PIN'): string {
  imp(ctx, 'from machine import Pin, PWM');
  const n = gpio(ctx, field);
  global(ctx, 'servo:angles', 'tariro_servo_angle = {}');
  global(ctx, `servo:${n}`, `servo${n} = PWM(Pin(${n}), freq=50)`);
  helper(
    ctx,
    'act:servo:write',
    lines(
      'def tariro_servo_write(servo, pin, angle):',
      '    # 0-180 degrees as a 544-2400 us pulse, the same range as the Arduino Servo library.',
      '    angle = min(max(angle, 0), 180)',
      '    servo.duty_ns(int((544 + (2400 - 544) * int(angle) / 180) * 1000))',
      '    tariro_servo_angle[pin] = angle',
    ),
  );
  return n;
}

function servoMoveHelper(ctx: EmitContext): void {
  imp(ctx, 'import time');
  helper(
    ctx,
    'act:servo:move',
    lines(
      'def tariro_servo_move(servo, pin, target, seconds):',
      '    # Move from the current angle to a new one in small steps (20 ms apart).',
      '    target = min(max(target, 0), 180)',
      '    steps = 0 if seconds <= 0 else int(seconds * 50)',
      '    start = tariro_servo_angle.get(pin, 90)',
      '    for i in range(1, steps + 1):',
      '        tariro_servo_write(servo, pin, start + (target - start) * i / steps)',
      '        time.sleep_ms(20)',
      '    tariro_servo_write(servo, pin, target)',
    ),
  );
}

function dcRuntime(ctx: EmitContext): void {
  imp(ctx, 'from machine import Pin, PWM');
  global(ctx, 'act:dc:state', 'tariro_dc = [None, None, None, None]  # (in1, in2, speed PWM) per motor');
  helper(
    ctx,
    'act:dc:fn',
    lines(
      'def tariro_dc_begin(i, in1, in2, en):',
      '    tariro_dc[i] = (Pin(in1, Pin.OUT, value=0), Pin(in2, Pin.OUT, value=0), PWM(Pin(en), freq=1000, duty=0))',
      '',
      'def tariro_dc_run(i, forward, speed_percent):',
      '    # speed_percent 0-100. A motor that was not set up is left alone.',
      '    m = tariro_dc[i]',
      '    if m is None:',
      '        return',
      '    m[0].value(1 if forward else 0)',
      '    m[1].value(0 if forward else 1)',
      '    m[2].duty(int(min(max(speed_percent, 0), 100) * 1023 / 100))',
      '',
      'def tariro_dc_stop(i, brake):',
      '    # Brake: both inputs high with the driver enabled shorts the motor. Coast: driver disabled.',
      '    m = tariro_dc[i]',
      '    if m is None:',
      '        return',
      '    m[0].value(1 if brake else 0)',
      '    m[1].value(1 if brake else 0)',
      '    m[2].duty(1023 if brake else 0)',
    ),
  );
}

function stepperRuntime(ctx: EmitContext): void {
  imp(ctx, 'import time');
  imp(ctx, 'from machine import Pin');
  global(
    ctx,
    'act:stepper:state',
    lines(
      '# Two steppers on STEP/DIR drivers. Defaults: 200 steps per turn, 60 RPM, no ramp.',
      'tariro_steppers = [{"step": None, "dir": None, "en": None, "per_turn": 200.0, "sps": 200.0, "accel": 0.0, "position": 0} for _ in range(2)]',
    ),
  );
  helper(
    ctx,
    'act:stepper:fn',
    lines(
      'def tariro_stepper_begin(i, step_pin, dir_pin, en_pin, steps_per_turn):',
      '    s = tariro_steppers[i]',
      '    rpm = s["sps"] * 60 / s["per_turn"]',
      '    if steps_per_turn > 0:',
      '        s["per_turn"] = steps_per_turn',
      '    s["sps"] = rpm * s["per_turn"] / 60',
      '    s["step"] = Pin(step_pin, Pin.OUT, value=0)',
      '    s["dir"] = Pin(dir_pin, Pin.OUT, value=0)',
      '    s["en"] = Pin(en_pin, Pin.OUT, value=0)  # EN is active low: motor current on',
      '',
      'def tariro_stepper_speed(i, rpm, rpm_per_second):',
      '    s = tariro_steppers[i]',
      '    s["sps"] = min(max(rpm, 1), 600) * s["per_turn"] / 60',
      '    s["accel"] = max(rpm_per_second, 0) * s["per_turn"] / 60',
      '',
      'def tariro_stepper_move(i, steps):',
      '    # Step with a trapezoid speed profile: speed up, cruise, slow down. Positive = clockwise.',
      '    s = tariro_steppers[i]',
      '    if s["step"] is None or steps == 0:',
      '        return',
      '    s["dir"].value(1 if steps > 0 else 0)',
      '    total = abs(steps)',
      '    start = min(s["sps"], max(s["accel"] * 0.05, 20)) if s["accel"] > 0 else s["sps"]',
      '    speed = start',
      '    for n in range(total):',
      '        if s["accel"] > 0:',
      '            stop_steps = (speed * speed - start * start) / (2 * s["accel"])',
      '            if total - n <= stop_steps:',
      '                speed = max(start, speed - s["accel"] / speed)',
      '            elif speed < s["sps"]:',
      '                speed = min(s["sps"], speed + s["accel"] / speed)',
      '        half = int(500000 / speed)',
      '        s["step"].value(1)',
      '        time.sleep_us(half)',
      '        s["step"].value(0)',
      '        time.sleep_us(half)',
      '    s["position"] += steps',
    ),
  );
}

function armRuntime(ctx: EmitContext): void {
  imp(ctx, 'import time');
  imp(ctx, 'from machine import Pin, PWM');
  global(
    ctx,
    'act:arm:state',
    lines(
      '# Arm joints: 0 base, 1 shoulder, 2 elbow, 3 wrist, 4 gripper.',
      'tariro_arm = {"joints": [None] * 5, "target": [90.0] * 5, "speed": 60.0}',
    ),
  );
  helper(
    ctx,
    'act:arm:fn',
    lines(
      'def tariro_arm_write(j, angle):',
      '    j["pwm"].duty_ns(int((544 + (2400 - 544) * int(angle) / 180) * 1000))',
      '',
      'def tariro_arm_joint(i, pin, min_angle, max_angle, home):',
      '    # Attach a joint and put it at its home angle (a servo cannot report where it is).',
      '    lo = min(max(min(min_angle, max_angle), 0), 180)',
      '    hi = min(max(max(min_angle, max_angle), 0), 180)',
      '    home = min(max(home, lo), hi)',
      '    j = {"pwm": PWM(Pin(pin), freq=50), "min": lo, "max": hi, "home": home, "angle": home}',
      '    tariro_arm["joints"][i] = j',
      '    tariro_arm["target"][i] = home',
      '    tariro_arm_write(j, home)',
      '',
      'def tariro_arm_go(mask):',
      '    # Move the joints in mask to their targets together, so they arrive at the same moment.',
      '    joints, target = tariro_arm["joints"], tariro_arm["target"]',
      '    moving = [i for i in range(5) if joints[i] is not None and mask & (1 << i)]',
      '    start = [j["angle"] if j is not None else 0 for j in joints]',
      '    furthest = 0',
      '    for i in moving:',
      '        target[i] = min(max(target[i], joints[i]["min"]), joints[i]["max"])',
      '        furthest = max(furthest, abs(target[i] - joints[i]["angle"]))',
      '    steps = int(furthest / tariro_arm["speed"] * 50)  # one step every 20 ms',
      '    for n in range(1, steps + 1):',
      '        for i in moving:',
      '            tariro_arm_write(joints[i], start[i] + (target[i] - start[i]) * n / steps)',
      '        time.sleep_ms(20)',
      '    for i in moving:',
      '        tariro_arm_write(joints[i], target[i])',
      '        joints[i]["angle"] = target[i]',
    ),
  );
}

const SEVEN_SEG = '[0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F]';
function sevenSegment(ctx: EmitContext, first?: number, anode?: boolean): void {
  imp(ctx, 'from machine import Pin');
  ctx.contribute({
    section: 'globals',
    key: 'act:7seg:cfg',
    priority: 20,
    code: `tariro_7seg = {"first": ${first ?? 2}, "anode": ${anode ? 'True' : 'False'}}`,
    ...(first !== undefined ? { override: true } : {}),
  });
  helper(
    ctx,
    'act:7seg',
    lines(
      'def tariro_seven_segment(value):',
      `    # Segments a-g for digits 0-9 (bit 0 = a), on seven pins in a row.`,
      `    bits = ${SEVEN_SEG}[int(value)] if value == int(value) and 0 <= value <= 9 else 0`,
      '    for i in range(7):',
      '        on = bool(bits & (1 << i))',
      '        Pin(tariro_7seg["first"] + i, Pin.OUT).value(1 if on != tariro_7seg["anode"] else 0)',
    ),
  );
}

const DRIVE: Record<string, [boolean, string, boolean, string]> = {
  FORWARD: [true, '1', true, '1'],
  BACKWARD: [false, '1', false, '1'],
  LEFT: [true, '0.4', true, '1'],
  RIGHT: [true, '1', true, '0.4'],
  SPIN_LEFT: [false, '1', true, '1'],
  SPIN_RIGHT: [true, '1', false, '1'],
};
const pyBool = (b: boolean) => (b ? 'True' : 'False');

export const actuatorsMicroPython: Record<string, Emitter> = {
  act_servo: statement((ctx) => {
    const n = servoInstance(ctx);
    return `tariro_servo_write(servo${n}, ${n}, ${ctx.value('ANGLE', PY.NONE, '90')})`;
  }),
  act_servo_move: statement((ctx) => {
    const n = servoInstance(ctx);
    servoMoveHelper(ctx);
    return `tariro_servo_move(servo${n}, ${n}, ${ctx.value('ANGLE', PY.NONE, '90')}, ${ctx.value('SECONDS', PY.NONE, '1')})`;
  }),
  act_servo_sweep: statement((ctx) => {
    const n = servoInstance(ctx);
    servoMoveHelper(ctx);
    const [from, to, secs] = [ctx.value('FROM', PY.NONE, '0'), ctx.value('TO', PY.NONE, '180'), ctx.value('SECONDS', PY.NONE, '1')];
    return lines(`tariro_servo_move(servo${n}, ${n}, ${from}, 0)`, `tariro_servo_move(servo${n}, ${n}, ${to}, ${secs})`, `tariro_servo_move(servo${n}, ${n}, ${from}, ${secs})`);
  }),
  act_relay: statement((ctx) => {
    const n = gpio(ctx);
    const activeLow = ctx.field('ACTIVE') !== 'HIGH';
    imp(ctx, 'from machine import Pin');
    // Start in the "off" state: an active-low relay would otherwise click on at power-up.
    ctx.contribute({ section: 'globals', key: `pin:pin${n}_out`, code: `pin${n}_out = Pin(${n}, Pin.OUT, value=${activeLow ? 1 : 0})`, priority: 20, override: true });
    return `pin${n}_out.value(${(ctx.field('STATE') !== 'OFF') !== activeLow ? 1 : 0})`;
  }),
  act_traffic_light: statement((ctx) => {
    const states = TRAFFIC_LIGHTS[ctx.field('LIGHT')] ?? TRAFFIC_LIGHTS['OFF']!;
    return ['RED', 'YELLOW', 'GREEN'].map((k, i) => `${pinObject(ctx, gpio(ctx, k), 'OUT')}.value(${states[i] ? 1 : 0})`).join('\n');
  }),
  act_rgb_led: statement((ctx) =>
    (['R', 'G', 'B'] as const)
      .map((k, i) => `${pwmObject(ctx, gpio(ctx, k))}.duty(int(min(max(${ctx.value(['RV', 'GV', 'BV'][i]!, PY.NONE, '0')}, 0), 255) * 1023 / 255))`)
      .join('\n'),
  ),
  act_seven_segment_setup: statement((ctx) => {
    sevenSegment(ctx, Number(ctx.field('FIRST')) || 2, ctx.field('KIND') === 'CA');
    return 'for i in range(7):\n    Pin(tariro_7seg["first"] + i, Pin.OUT)';
  }),
  act_seven_segment_show: statement((ctx) => {
    sevenSegment(ctx);
    return `tariro_seven_segment(${ctx.value('DIGIT', PY.NONE, '0')})`;
  }),

  act_dc_setup: statement((ctx) => {
    dcRuntime(ctx);
    return `tariro_dc_begin(${index(ctx, 'MOTOR', 3)}, ${gpio(ctx, 'IN1')}, ${gpio(ctx, 'IN2')}, ${gpio(ctx, 'EN')})`;
  }),
  act_dc_run: statement((ctx) => {
    dcRuntime(ctx);
    return `tariro_dc_run(${index(ctx, 'MOTOR', 3)}, ${pyBool(ctx.field('DIRECTION') !== 'BACKWARD')}, ${ctx.value('SPEED', PY.NONE, '0')})`;
  }),
  act_dc_stop: statement((ctx) => {
    dcRuntime(ctx);
    const brake = pyBool(ctx.field('HOW') === 'BRAKE');
    if (ctx.field('MOTOR') === 'ALL') return `for i in range(4):\n    tariro_dc_stop(i, ${brake})`;
    return `tariro_dc_stop(${index(ctx, 'MOTOR', 3)}, ${brake})`;
  }),
  act_dc_drive: statement((ctx) => {
    dcRuntime(ctx);
    const speed = ctx.value('SPEED', PY.MULTIPLICATIVE, '0');
    const [lf, lk, rf, rk] = DRIVE[ctx.field('MOVE')] ?? DRIVE['FORWARD']!;
    const scaled = (k: string) => (k === '1' ? speed : `${speed} * ${k}`);
    return lines(`tariro_dc_run(0, ${pyBool(lf)}, ${scaled(lk)})`, `tariro_dc_run(1, ${pyBool(rf)}, ${scaled(rk)})`);
  }),

  act_stepper_setup: statement((ctx) => {
    stepperRuntime(ctx);
    return `tariro_stepper_begin(${index(ctx, 'STEPPER', 1)}, ${gpio(ctx, 'STEP')}, ${gpio(ctx, 'DIR')}, ${gpio(ctx, 'EN')}, ${ctx.value('SPR', PY.NONE, '200')})`;
  }),
  act_stepper_speed: statement((ctx) => {
    stepperRuntime(ctx);
    return `tariro_stepper_speed(${index(ctx, 'STEPPER', 1)}, ${ctx.value('RPM', PY.NONE, '60')}, ${ctx.value('ACCEL', PY.NONE, '0')})`;
  }),
  act_stepper_move: statement((ctx) => {
    stepperRuntime(ctx);
    const i = index(ctx, 'STEPPER', 1);
    const amount = ctx.value('AMOUNT', PY.MULTIPLICATIVE, '0');
    const unit = ctx.field('UNIT');
    const steps = unit === 'DEGREES' ? `${amount} * tariro_steppers[${i}]["per_turn"] / 360` : unit === 'TURNS' ? `${amount} * tariro_steppers[${i}]["per_turn"]` : amount;
    return `tariro_stepper_move(${i}, ${ctx.field('DIRECTION') === 'CCW' ? '-' : ''}round(${steps}))`;
  }),
  act_stepper_goto: statement((ctx) => {
    stepperRuntime(ctx);
    const i = index(ctx, 'STEPPER', 1);
    return `tariro_stepper_move(${i}, round(${ctx.value('ANGLE', PY.MULTIPLICATIVE, '0')} * tariro_steppers[${i}]["per_turn"] / 360) - tariro_steppers[${i}]["position"])`;
  }),
  act_stepper_zero: statement((ctx) => {
    stepperRuntime(ctx);
    return `tariro_steppers[${index(ctx, 'STEPPER', 1)}]["position"] = 0`;
  }),
  act_stepper_power: statement((ctx) => {
    stepperRuntime(ctx);
    const i = index(ctx, 'STEPPER', 1);
    // A4988 and DRV8825: EN is active low.
    return `if tariro_steppers[${i}]["en"] is not None:\n    tariro_steppers[${i}]["en"].value(${ctx.field('STATE') === 'ON' ? 0 : 1})`;
  }),
  act_stepper_position: value('number', (ctx) => {
    stepperRuntime(ctx);
    const i = index(ctx, 'STEPPER', 1);
    return [`tariro_steppers[${i}]["position"] * 360 / tariro_steppers[${i}]["per_turn"]`, PY.MULTIPLICATIVE];
  }),

  arm_joint_setup: statement((ctx) => {
    armRuntime(ctx);
    return `tariro_arm_joint(${index(ctx, 'JOINT', 4)}, ${gpio(ctx)}, ${ctx.value('MIN', PY.NONE, '0')}, ${ctx.value('MAX', PY.NONE, '180')}, ${ctx.value('HOME', PY.NONE, '90')})`;
  }),
  arm_speed: statement((ctx) => {
    armRuntime(ctx);
    return `tariro_arm["speed"] = min(max(${ctx.value('SPEED', PY.NONE, '60')}, 5), 360)`;
  }),
  arm_joint_move: statement((ctx) => {
    armRuntime(ctx);
    const i = index(ctx, 'JOINT', 4);
    return lines(`tariro_arm["target"][${i}] = ${ctx.value('ANGLE', PY.NONE, '90')}`, `tariro_arm_go(1 << ${i})`);
  }),
  arm_pose: statement((ctx) => {
    armRuntime(ctx);
    return lines(...['BASE', 'SHOULDER', 'ELBOW', 'WRIST'].map((k, i) => `tariro_arm["target"][${i}] = ${ctx.value(k, PY.NONE, '90')}`), 'tariro_arm_go(0x0F)');
  }),
  arm_home: statement((ctx) => {
    armRuntime(ctx);
    return lines(
      'for i in range(5):',
      '    if tariro_arm["joints"][i] is not None:',
      '        tariro_arm["target"][i] = tariro_arm["joints"][i]["home"]',
      'tariro_arm_go(0x1F)',
    );
  }),
  arm_gripper: statement((ctx) => {
    armRuntime(ctx);
    return lines(
      'if tariro_arm["joints"][4] is not None:',
      `    tariro_arm["target"][4] = tariro_arm["joints"][4]["${ctx.field('ACTION') === 'CLOSE' ? 'min' : 'max'}"]`,
      'tariro_arm_go(1 << 4)',
    );
  }),
  arm_joint_angle: value('number', (ctx) => {
    armRuntime(ctx);
    const i = index(ctx, 'JOINT', 4);
    return [`(tariro_arm["joints"][${i}]["angle"] if tariro_arm["joints"][${i}] is not None else 0)`, PY.ATOMIC];
  }),
};
