/**
 * Outputs from the kits: servo motors, relays (and the IoT kit pump), traffic-light module,
 * 1-digit 7-segment display and an RGB LED.
 */
import { ORDER, type EmitContext, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { dropdown, include, num, pinArg, pinField, pinId, pinMode, STATEMENT, valueIn } from './util.js';

const STYLE = 'actuators_blocks';

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

const emitters: Record<string, Emitter> = {
  act_servo: {
    kind: 'statement',
    emit: (ctx) => {
      const pin = pinField(ctx, 'digital');
      include(ctx, ctx.board.family === 'esp32' ? 'ESP32Servo.h' : 'Servo.h');
      const name = `servo_${pinId(pin)}`;
      ctx.contribute({ section: 'globals', key: `servo:${pin}`, code: `Servo ${name};`, priority: 20 });
      ctx.contribute({ section: 'setup.init', key: `servo:attach:${pin}`, code: `${name}.attach(${pin});`, priority: 20 });
      return `${name}.write(constrain((int)(${ctx.value('ANGLE', ORDER.NONE, '90')}), 0, 180));`;
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
};

export const actuatorsExtension: ExtensionManifest = {
  id: 'actuators',
  name: 'Motors & outputs',
  version: '0.1.0',
  category: 'actuators',
  kits: ['Starter', 'Robotics', 'IoT'],
  description: 'Servo motors, relays and the water pump, traffic-light module, 7-segment display and RGB LED.',
  boards: '*',
  libraries: [
    { name: 'Servo', version: '1.3.0', families: ['avr'] },
    { name: 'ESP32Servo', version: '3.2.1', families: ['esp32'] },
  ],
  blocks,
  emitters: { arduino: emitters },
  toolbox: [
    {
      id: 'actuators',
      name: 'Outputs',
      style: 'actuators_category',
      contents: [
        { kind: 'block', type: 'act_servo', inputs: { ANGLE: num(90) } },
        { kind: 'block', type: 'act_relay' },
        { kind: 'block', type: 'act_traffic_light' },
        { kind: 'sep' },
        { kind: 'block', type: 'act_seven_segment_setup' },
        { kind: 'block', type: 'act_seven_segment_show', inputs: { DIGIT: num(7) } },
        { kind: 'sep' },
        { kind: 'block', type: 'act_rgb_led', inputs: { RV: num(255), GV: num(0), BV: num(128) } },
      ],
    },
  ],
};
