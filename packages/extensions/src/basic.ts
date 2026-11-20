/**
 * Tariro Basic Components: the fundamental parts every project starts from. This pack owns the
 * simple LED, buzzer and switch blocks, the rotary encoder blocks and a PID controller, and its
 * toolbox category also lists the existing sensor and simple output blocks (owned by the
 * `sensors` and `actuators` packs, whose block types are unchanged so saved projects still open).
 *
 * Rotary encoders count inside interrupts. Which pins can interrupt differs per board
 * (`pins.interruptPins`), so the emitters warn instead of generating code that would silently
 * miss pulses.
 */
import { basicMicroPython } from './micropython-components.js';
import { interruptPins, ORDER, type EmitContext, type Emitter, type ExperienceLevel, type ExtensionManifest } from '@tariro-studio/core';
import { dropdown, pinArg, pinField, pinMode, num, STATEMENT, valueIn } from './util.js';
import { basicLive, pidLive } from './live.js';

const STYLE = 'basic_blocks';

const ENCODERS: Array<[string, string]> = [
  ['left wheel', 'LEFT'],
  ['right wheel', 'RIGHT'],
  ['encoder 1', 'E1'],
  ['encoder 2', 'E2'],
];
const ENCODER_INDEX: Record<string, number> = { LEFT: 0, RIGHT: 1, E1: 2, E2: 3 };
const READINGS: Array<[string, string]> = [
  ['count', 'COUNT'],
  ['position (turns)', 'TURNS'],
  ['angle (degrees)', 'ANGLE'],
  ['direction (1, -1 or 0)', 'DIRECTION'],
  ['speed (RPM)', 'RPM'],
  ['speed (degrees per second)', 'DEG_PER_S'],
  ['wheel distance (cm)', 'DISTANCE'],
  ['wheel speed (cm per second)', 'CM_PER_S'],
];

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'basic_led',
    json: {
      type: 'basic_led',
      message0: 'turn LED on pin %1 %2',
      args0: [pinArg('digital', '13'), dropdown('STATE', [['on', 'ON'], ['off', 'OFF']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'An LED wired from the pin through a resistor (220 Ω to 1 kΩ) to GND.',
    },
  },
  {
    type: 'basic_led_brightness',
    json: {
      type: 'basic_led_brightness',
      message0: 'set LED on pin %1 brightness to %2 %%',
      args0: [pinArg('pwm', '3'), valueIn('LEVEL', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Dims an LED on a PWM (~) pin: 0 is off, 100 is full brightness.',
    },
  },
  {
    type: 'basic_buzzer',
    json: {
      type: 'basic_buzzer',
      message0: 'turn buzzer on pin %1 %2',
      args0: [pinArg('digital', '8'), dropdown('STATE', [['on', 'ON'], ['off', 'OFF']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'For an active buzzer module (it makes its own tone). For notes, use "play tone" in Pins.',
    },
  },
  {
    type: 'basic_switch',
    json: {
      type: 'basic_switch',
      message0: 'switch on pin %1 is %2',
      args0: [pinArg('digital', '2'), dropdown('STATE', [['on (closed)', 'CLOSED'], ['off (open)', 'OPEN']])],
      output: 'Boolean',
      style: STYLE,
      tooltip: 'For a slide or toggle switch wired between the pin and GND (the internal pull-up is switched on).',
    },
  },
  {
    type: 'enc_setup',
    json: {
      type: 'enc_setup',
      message0: 'set up %1 encoder as %2 pin A %3 pin B %4',
      args0: [
        dropdown('ENCODER', ENCODERS),
        dropdown('KIND', [['quadrature (2 channels)', 'QUAD'], ['single channel', 'SINGLE']]),
        pinArg('digital', '2', 'PIN_A'),
        pinArg('digital', '8', 'PIN_B'),
      ],
      ...STATEMENT,
      style: STYLE,
      tooltip:
        'Optical or magnetic incremental encoder. Pin A must be an interrupt pin (2 or 3 on Uno-type boards). A single-channel encoder counts pulses but cannot tell direction; its pin B is not used.',
    },
  },
  {
    type: 'enc_config',
    json: {
      type: 'enc_config',
      message0: 'set %1 encoder: %2 pulses per turn, gear ratio %3, wheel diameter %4 mm',
      args0: [dropdown('ENCODER', ENCODERS), valueIn('PPR', 'Number'), valueIn('GEAR', 'Number'), valueIn('DIAMETER', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip:
        'Resolution of the encoder. Pulses per turn is printed on the encoder or its disc (20 slots is common). Use gear ratio 1 when the encoder sits on the wheel shaft.',
    },
  },
  {
    type: 'enc_read',
    json: {
      type: 'enc_read',
      message0: '%1 encoder %2',
      args0: [dropdown('ENCODER', ENCODERS), dropdown('WHAT', READINGS)],
      output: 'Number',
      style: STYLE,
      tooltip: 'Reads the encoder. Speed is measured between readings, so read it regularly (about 10 times a second).',
    },
  },
  {
    type: 'enc_reset',
    json: {
      type: 'enc_reset',
      message0: 'reset %1 encoder count',
      args0: [dropdown('ENCODER', [...ENCODERS, ['all', 'ALL']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Sets the count back to zero, so distance and angle start again from here.',
    },
  },
  {
    type: 'enc_compare',
    json: {
      type: 'enc_compare',
      message0: '%1 encoder minus %2 encoder: %3',
      args0: [dropdown('A', ENCODERS), dropdown('B', [ENCODERS[1]!, ENCODERS[0]!, ENCODERS[2]!, ENCODERS[3]!]), dropdown('WHAT', [['count', 'COUNT'], ['wheel distance (cm)', 'DISTANCE'], ['speed (RPM)', 'RPM']])],
      output: 'Number',
      style: STYLE,
      tooltip: 'How far ahead the first encoder is. Zero means both wheels have turned the same; use it to drive straight.',
    },
  },
  {
    type: 'enc_absolute_analog',
    json: {
      type: 'enc_absolute_analog',
      message0: 'absolute encoder angle (degrees) on pin %1',
      args0: [pinArg('analog', 'A0')],
      output: 'Number',
      style: STYLE,
      tooltip: 'For an absolute encoder or angle sensor with an analog output: 0 V is 0° and full scale is 360°.',
    },
  },
  {
    type: 'enc_as5600',
    json: {
      type: 'enc_as5600',
      message0: 'magnetic encoder AS5600 angle (degrees)',
      output: 'Number',
      style: STYLE,
      tooltip: 'AS5600 magnetic absolute encoder on I²C (SDA/SCL), address 0x36. Returns 0 to 360; -1 if the sensor does not answer.',
    },
  },
  {
    type: 'basic_pid',
    json: {
      type: 'basic_pid',
      message0: 'PID output: target %1 measured %2 Kp %3 Ki %4 Kd %5',
      args0: [valueIn('TARGET', 'Number'), valueIn('MEASURED', 'Number'), valueIn('KP', 'Number'), valueIn('KI', 'Number'), valueIn('KD', 'Number')],
      output: 'Number',
      inputsInline: true,
      style: STYLE,
      tooltip:
        'Closed-loop control (advanced). Returns a correction between -100 and 100 that moves "measured" towards "target". Call it regularly, and add the result to a motor speed.',
    },
  },
];

const value = (emit: (ctx: EmitContext) => [string, number], type: 'number' | 'boolean' = 'number'): Emitter => ({ kind: 'value', type, emit });
const statement = (emit: (ctx: EmitContext) => string): Emitter => ({ kind: 'statement', emit });

/** The shared encoder runtime: four slots, counted in interrupts, read with interrupts paused. */
/** Encoder runtime (shared with the autonomy blocks). */
export function encoderRuntime(ctx: EmitContext): void {
  ctx.contribute({
    section: 'globals',
    key: 'enc:state',
    priority: 20,
    code: [
      '// Rotary encoders. Counts change inside interrupts, so they are volatile.',
      '#if defined(ESP32)',
      '#define TARIRO_ISR IRAM_ATTR',
      '#else',
      '#define TARIRO_ISR',
      '#endif',
      'struct TariroEncoder {',
      '  uint8_t pinA;',
      '  uint8_t pinB;',
      '  bool quadrature;',
      '  volatile long count;',
      '  double countsPerTurn;',
      '  double wheelDiameterMm;',
      '  long lastCount;',
      '  unsigned long lastMicros;',
      '  double turnsPerSecond;',
      '};',
      '// 0 = left wheel, 1 = right wheel, 2 = encoder 1, 3 = encoder 2. Defaults: 20 pulses per turn, 65 mm wheel.',
      'TariroEncoder tariroEncoders[4] = {',
      '  {0, 0, false, 0, 20.0, 65.0, 0, 0, 0.0},',
      '  {0, 0, false, 0, 20.0, 65.0, 0, 0, 0.0},',
      '  {0, 0, false, 0, 20.0, 65.0, 0, 0, 0.0},',
      '  {0, 0, false, 0, 20.0, 65.0, 0, 0, 0.0},',
      '};',
    ].join('\n'),
  });
  ctx.contribute({
    section: 'functions',
    key: 'enc:fn',
    priority: 20,
    code: [
      '// One pulse edge on channel A. With two channels, B tells which way the shaft turned.',
      'void TARIRO_ISR tariroEncoderTick(uint8_t i) {',
      '  TariroEncoder &e = tariroEncoders[i];',
      '  if (e.quadrature && digitalRead(e.pinA) == digitalRead(e.pinB)) e.count--;',
      '  else e.count++;',
      '}',
      'void TARIRO_ISR tariroEncoderIsr0() { tariroEncoderTick(0); }',
      'void TARIRO_ISR tariroEncoderIsr1() { tariroEncoderTick(1); }',
      'void TARIRO_ISR tariroEncoderIsr2() { tariroEncoderTick(2); }',
      'void TARIRO_ISR tariroEncoderIsr3() { tariroEncoderTick(3); }',
      '',
      '// Quadrature counts both edges of A (2 counts per pulse); single channel counts rising edges.',
      'void tariroEncoderBegin(uint8_t i, uint8_t pinA, uint8_t pinB, bool quadrature) {',
      '  TariroEncoder &e = tariroEncoders[i];',
      '  // Keep the resolution if "set encoder" ran first: only the counts-per-pulse factor changes.',
      '  e.countsPerTurn = e.countsPerTurn / (e.quadrature ? 2.0 : 1.0) * (quadrature ? 2.0 : 1.0);',
      '  e.pinA = pinA;',
      '  e.pinB = pinB;',
      '  e.quadrature = quadrature;',
      '  pinMode(pinA, INPUT_PULLUP);',
      '  if (quadrature) pinMode(pinB, INPUT_PULLUP);',
      '  void (*isr)() = i == 0 ? tariroEncoderIsr0 : i == 1 ? tariroEncoderIsr1 : i == 2 ? tariroEncoderIsr2 : tariroEncoderIsr3;',
      '  attachInterrupt(digitalPinToInterrupt(pinA), isr, quadrature ? CHANGE : RISING);',
      '  e.lastMicros = micros();',
      '}',
      '',
      'void tariroEncoderResolution(uint8_t i, double pulsesPerTurn, double gearRatio, double wheelDiameterMm) {',
      '  TariroEncoder &e = tariroEncoders[i];',
      '  if (pulsesPerTurn > 0 && gearRatio > 0) e.countsPerTurn = pulsesPerTurn * gearRatio * (e.quadrature ? 2.0 : 1.0);',
      '  if (wheelDiameterMm > 0) e.wheelDiameterMm = wheelDiameterMm;',
      '}',
      '',
      'long tariroEncoderCount(uint8_t i) {',
      '  noInterrupts();',
      '  long c = tariroEncoders[i].count;',
      '  interrupts();',
      '  return c;',
      '}',
      '',
      'void tariroEncoderReset(uint8_t i) {',
      '  noInterrupts();',
      '  tariroEncoders[i].count = 0;',
      '  interrupts();',
      '  tariroEncoders[i].lastCount = 0;',
      '  tariroEncoders[i].turnsPerSecond = 0;',
      '  tariroEncoders[i].lastMicros = micros();',
      '}',
      '',
      'double tariroEncoderTurns(uint8_t i) { return tariroEncoderCount(i) / tariroEncoders[i].countsPerTurn; }',
      '',
      '// Speed from the counts since the last measurement (at least 50 ms earlier).',
      'double tariroEncoderTurnsPerSecond(uint8_t i) {',
      '  TariroEncoder &e = tariroEncoders[i];',
      '  unsigned long now = micros();',
      '  unsigned long elapsed = now - e.lastMicros;',
      '  if (elapsed >= 50000UL) {',
      '    long c = tariroEncoderCount(i);',
      '    e.turnsPerSecond = ((c - e.lastCount) / e.countsPerTurn) * 1000000.0 / elapsed;',
      '    e.lastCount = c;',
      '    e.lastMicros = now;',
      '  }',
      '  return e.turnsPerSecond;',
      '}',
      '',
      '// Wheel circumference in cm.',
      'double tariroEncoderCircumference(uint8_t i) { return tariroEncoders[i].wheelDiameterMm * 3.14159265 / 10.0; }',
    ].join('\n'),
  });
}

const encoderIndex = (ctx: EmitContext, field = 'ENCODER'): number => ENCODER_INDEX[ctx.field(field)] ?? 0;

function reading(ctx: EmitContext, i: number, what: string): [string, number] {
  encoderRuntime(ctx);
  switch (what) {
    case 'TURNS':
      return [`tariroEncoderTurns(${i})`, ORDER.POSTFIX];
    case 'ANGLE':
      return [`tariroEncoderTurns(${i}) * 360.0`, ORDER.MULTIPLICATIVE];
    case 'DIRECTION':
      return [`(tariroEncoderTurnsPerSecond(${i}) > 0) - (tariroEncoderTurnsPerSecond(${i}) < 0)`, ORDER.ADDITIVE];
    case 'RPM':
      return [`tariroEncoderTurnsPerSecond(${i}) * 60.0`, ORDER.MULTIPLICATIVE];
    case 'DEG_PER_S':
      return [`tariroEncoderTurnsPerSecond(${i}) * 360.0`, ORDER.MULTIPLICATIVE];
    case 'DISTANCE':
      return [`tariroEncoderTurns(${i}) * tariroEncoderCircumference(${i})`, ORDER.MULTIPLICATIVE];
    case 'CM_PER_S':
      return [`tariroEncoderTurnsPerSecond(${i}) * tariroEncoderCircumference(${i})`, ORDER.MULTIPLICATIVE];
    default:
      return [`tariroEncoderCount(${i})`, ORDER.POSTFIX];
  }
}

const emitters: Record<string, Emitter> = {
  basic_led: statement((ctx) => {
    const pin = pinField(ctx, 'digital');
    pinMode(ctx, pin, 'OUTPUT');
    return `digitalWrite(${pin}, ${ctx.field('STATE') === 'OFF' ? 'LOW' : 'HIGH'});`;
  }),
  basic_led_brightness: statement((ctx) => {
    const pin = pinField(ctx, 'pwm');
    pinMode(ctx, pin, 'OUTPUT');
    return `analogWrite(${pin}, constrain((int)((${ctx.value('LEVEL', ORDER.NONE, '0')}) * 255.0 / 100.0), 0, 255));`;
  }),
  basic_buzzer: statement((ctx) => {
    const pin = pinField(ctx, 'digital');
    pinMode(ctx, pin, 'OUTPUT');
    return `digitalWrite(${pin}, ${ctx.field('STATE') === 'OFF' ? 'LOW' : 'HIGH'});`;
  }),
  basic_switch: value((ctx) => {
    const pin = pinField(ctx, 'digital');
    pinMode(ctx, pin, 'INPUT_PULLUP');
    // Wired to GND: closed pulls the pin LOW.
    return [`digitalRead(${pin}) == ${ctx.field('STATE') === 'OPEN' ? 'HIGH' : 'LOW'}`, ORDER.EQUALITY];
  }, 'boolean'),

  enc_setup: statement((ctx) => {
    encoderRuntime(ctx);
    const a = pinField(ctx, 'digital', 'PIN_A');
    const quad = ctx.field('KIND') !== 'SINGLE';
    const b = quad ? pinField(ctx, 'digital', 'PIN_B') : a;
    const capable = interruptPins(ctx.board).map(String);
    if (!capable.includes(a))
      ctx.warn(`Pin ${a} cannot count encoder pulses on ${ctx.board.name}. Use ${capable.slice(0, 6).join(', ')}${capable.length > 6 ? '…' : ''} for pin A.`);
    if (quad && a === b) ctx.warn('A quadrature encoder needs two different pins for A and B.');
    // Also set up by tariroEncoderBegin; declared here so a clash with another block on the pin is reported.
    pinMode(ctx, a, 'INPUT_PULLUP');
    if (quad) pinMode(ctx, b, 'INPUT_PULLUP');
    return `tariroEncoderBegin(${encoderIndex(ctx)}, ${a}, ${b}, ${quad});`;
  }),
  enc_config: statement((ctx) => {
    encoderRuntime(ctx);
    return `tariroEncoderResolution(${encoderIndex(ctx)}, ${ctx.value('PPR', ORDER.COMMA, '20')}, ${ctx.value('GEAR', ORDER.COMMA, '1')}, ${ctx.value('DIAMETER', ORDER.COMMA, '65')});`;
  }),
  enc_read: value((ctx) => reading(ctx, encoderIndex(ctx), ctx.field('WHAT'))),
  enc_reset: statement((ctx) => {
    encoderRuntime(ctx);
    if (ctx.field('ENCODER') === 'ALL') return [0, 1, 2, 3].map((i) => `tariroEncoderReset(${i});`).join('\n');
    return `tariroEncoderReset(${encoderIndex(ctx)});`;
  }),
  enc_compare: value((ctx) => {
    const what = ctx.field('WHAT');
    const [a] = reading(ctx, encoderIndex(ctx, 'A'), what);
    const [b] = reading(ctx, encoderIndex(ctx, 'B'), what);
    return [`(${a}) - (${b})`, ORDER.ADDITIVE];
  }),
  enc_absolute_analog: value((ctx) => {
    const pin = pinField(ctx, 'analog');
    return [`analogRead(${pin}) * 360.0 / ${ctx.board.family === 'esp32' ? '4095.0' : '1023.0'}`, ORDER.MULTIPLICATIVE];
  }),
  enc_as5600: value((ctx) => {
    ctx.contribute({ section: 'includes', key: 'include:Wire.h', code: '#include <Wire.h>', priority: 50 });
    ctx.contribute({ section: 'setup.init', key: 'wire:begin', code: 'Wire.begin();', priority: 5 });
    ctx.contribute({
      section: 'functions',
      key: 'enc:as5600',
      priority: 20,
      code: [
        '// AS5600 magnetic encoder: 12-bit angle in registers 0x0E (high) and 0x0F (low).',
        'double tariroAs5600Angle() {',
        '  Wire.beginTransmission(0x36);',
        '  Wire.write(0x0E);',
        '  if (Wire.endTransmission(false) != 0) return -1;',
        '  if (Wire.requestFrom(0x36, 2) != 2) return -1;',
        '  int raw = ((Wire.read() & 0x0F) << 8) | Wire.read();',
        '  return raw * 360.0 / 4096.0;',
        '}',
      ].join('\n'),
    });
    return ['tariroAs5600Angle()', ORDER.POSTFIX];
  }),
  basic_pid: value((ctx) => {
    const state = ctx.temp('pid');
    ctx.contribute({
      section: 'globals',
      key: 'pid:type',
      priority: 20,
      code: '// State of one PID controller: accumulated error, previous error, time of the last step.\nstruct TariroPid {\n  double integral;\n  double previous;\n  unsigned long lastMillis;\n};',
    });
    ctx.contribute({ section: 'globals', key: `pid:${state}`, priority: 21, code: `TariroPid ${state} = {0, 0, 0};` });
    ctx.contribute({
      section: 'functions',
      key: 'pid:fn',
      priority: 20,
      code: [
        '// One PID step. The output and the integral are limited to ±100 so a stalled motor cannot wind it up.',
        'double tariroPid(TariroPid &s, double target, double measured, double kp, double ki, double kd) {',
        '  unsigned long now = millis();',
        '  double dt = s.lastMillis == 0 ? 0.0 : (now - s.lastMillis) / 1000.0;',
        '  s.lastMillis = now;',
        '  double error = target - measured;',
        '  double derivative = 0.0;',
        '  if (dt > 0.0) {',
        '    s.integral = constrain(s.integral + error * dt, -100.0, 100.0);',
        '    derivative = (error - s.previous) / dt;',
        '  }',
        '  s.previous = error;',
        '  return constrain(kp * error + ki * s.integral + kd * derivative, -100.0, 100.0);',
        '}',
      ].join('\n'),
    });
    const arg = (n: string, d: string) => ctx.value(n, ORDER.COMMA, d);
    return [`tariroPid(${state}, ${arg('TARGET', '0')}, ${arg('MEASURED', '0')}, ${arg('KP', '1')}, ${arg('KI', '0')}, ${arg('KD', '0')})`, ORDER.POSTFIX];
  }),
};

const b = (type: string, extra: { level?: ExperienceLevel } & Record<string, unknown> = {}) => ({ kind: 'block' as const, type, ...extra });
const label = (text: string) => ({ kind: 'label' as const, text });

export const basicExtension: ExtensionManifest = {
  id: 'basic',
  name: 'Tariro Basic Components',
  version: '0.1.0',
  category: 'sensors',
  kits: ['Starter', 'Robotics', 'IoT'],
  description: 'LEDs, buzzers, buttons, switches, common sensors, rotary encoders and a PID controller.',
  boards: '*',
  blocks,
  emitters: { arduino: emitters, micropython: basicMicroPython },
  live: { ...basicLive, ...pidLive },
  toolbox: [
    {
      id: 'basic',
      name: 'Basic Components',
      style: 'basic_category',
      contents: [
        label('Lights and sound'),
        b('basic_led'),
        b('basic_led_brightness', { inputs: { LEVEL: num(50) } }),
        b('act_rgb_led', { inputs: { RV: num(255), GV: num(0), BV: num(128) } }),
        b('act_traffic_light'),
        b('basic_buzzer'),
        b('act_relay', { level: 'intermediate' }),
        label('Buttons and switches'),
        b('sensor_button_pressed'),
        b('basic_switch'),
        label('Sensors'),
        b('sensor_analog_level'),
        b('sensor_detect'),
        b('sensor_ultrasonic_cm'),
        b('sensor_dht', { level: 'intermediate' }),
        b('sensor_mpu6050', { level: 'intermediate' }),
        b('sensor_colour_setup', { level: 'intermediate' }),
        b('sensor_colour_read', { level: 'intermediate' }),
        label('Rotary encoders'),
        b('enc_setup', { level: 'intermediate' }),
        b('enc_config', { level: 'advanced', inputs: { PPR: num(20), GEAR: num(1), DIAMETER: num(65) } }),
        b('enc_read', { level: 'intermediate' }),
        b('enc_reset', { level: 'intermediate' }),
        b('enc_compare', { level: 'intermediate' }),
        b('enc_absolute_analog', { level: 'advanced' }),
        b('enc_as5600', { level: 'advanced' }),
        label('Control (advanced)'),
        b('basic_pid', { level: 'advanced', inputs: { TARGET: num(60), MEASURED: num(0), KP: num(1), KI: num(0), KD: num(0) } }),
        label('Simple displays'),
        b('act_seven_segment_setup', { level: 'intermediate' }),
        b('act_seven_segment_show', { level: 'intermediate', inputs: { DIGIT: num(7) } }),
      ],
    },
  ],
};
