/**
 * Sensors from the Starter, Robotics and IoT kits: buttons, analog modules (potentiometer, LDR,
 * soil, water level, rain), digital detectors (IR, PIR, sound, rain), DHT11/22, HC-SR04
 * ultrasonic, TCS3200 colour sensor and MPU6050 motion sensor (raw I²C, no library).
 */
import { ORDER, type EmitContext, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { adcMax, dropdown, include, pinArg, pinField, pinId, pinMode, STATEMENT } from './util.js';

const STYLE = 'sensors_blocks';

const ANALOG_SENSORS: Array<[string, string]> = [
  ['potentiometer', 'POT'],
  ['light sensor (LDR)', 'LDR'],
  ['soil moisture sensor', 'SOIL'],
  ['water level sensor', 'WATER'],
  ['rain sensor', 'RAIN'],
];

/** Digital detector modules and the level their output has when they detect something. */
const DETECTORS: Record<string, { label: string; active: 'HIGH' | 'LOW' }> = {
  IR: { label: 'IR obstacle sensor', active: 'LOW' },
  PIR: { label: 'PIR motion sensor', active: 'HIGH' },
  SOUND: { label: 'sound sensor', active: 'HIGH' },
  RAIN: { label: 'rain sensor (digital)', active: 'LOW' },
};

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'sensor_button_pressed',
    json: {
      type: 'sensor_button_pressed',
      message0: 'button on pin %1 is pressed',
      args0: [pinArg('digital', '2')],
      output: 'Boolean',
      style: STYLE,
      tooltip: 'For a push button wired between the pin and GND (the internal pull-up is switched on).',
    },
  },
  {
    type: 'sensor_analog_level',
    json: {
      type: 'sensor_analog_level',
      message0: '%1 on pin %2 (0–100)',
      args0: [dropdown('SENSOR', ANALOG_SENSORS), pinArg('analog', 'A0')],
      output: 'Number',
      style: STYLE,
      tooltip: 'Reads an analog sensor module and scales it to 0–100. Soil and rain modules read higher when dry.',
    },
  },
  {
    type: 'sensor_detect',
    json: {
      type: 'sensor_detect',
      message0: '%1 on pin %2 detects something',
      args0: [dropdown('SENSOR', Object.entries(DETECTORS).map(([k, v]) => [v.label, k])), pinArg('digital', '7')],
      output: 'Boolean',
      style: STYLE,
      tooltip: 'True while the module signals a detection. If your module works the other way round, use "not".',
    },
  },
  {
    type: 'sensor_dht',
    json: {
      type: 'sensor_dht',
      message0: '%1 %2 on pin %3',
      args0: [
        dropdown('MODEL', [['DHT11', 'DHT11'], ['DHT22', 'DHT22']]),
        dropdown('READING', [['temperature (°C)', 'TEMP'], ['humidity (%)', 'HUM']]),
        pinArg('digital', '2'),
      ],
      output: 'Number',
      style: STYLE,
      tooltip: 'Temperature and humidity sensor. Read it at most once every 2 seconds.',
    },
  },
  {
    type: 'sensor_ultrasonic_cm',
    json: {
      type: 'sensor_ultrasonic_cm',
      message0: 'distance (cm) trig %1 echo %2',
      args0: [pinArg('digital', '12', 'TRIG'), pinArg('digital', '13', 'ECHO')],
      output: 'Number',
      style: STYLE,
      tooltip: 'HC-SR04 ultrasonic distance, 2–400 cm. Returns 0 when nothing echoes back.',
    },
  },
  {
    type: 'sensor_colour_setup',
    json: {
      type: 'sensor_colour_setup',
      message0: 'set up colour sensor S0 %1 S1 %2 S2 %3 S3 %4 OUT %5',
      args0: [
        pinArg('digital', '8', 'S0'),
        pinArg('digital', '9', 'S1'),
        pinArg('digital', '10', 'S2'),
        pinArg('digital', '11', 'S3'),
        pinArg('digital', '12', 'OUT'),
      ],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'TCS3200 colour sensor. Put this in "when board starts up".',
    },
  },
  {
    type: 'sensor_colour_read',
    json: {
      type: 'sensor_colour_read',
      message0: 'colour sensor %1 level',
      args0: [dropdown('COLOUR', [['red', 'RED'], ['green', 'GREEN'], ['blue', 'BLUE']])],
      output: 'Number',
      style: STYLE,
      tooltip: 'How strongly the sensor sees this colour (higher = more). Compare red, green and blue.',
    },
  },
  {
    type: 'sensor_mpu6050',
    json: {
      type: 'sensor_mpu6050',
      message0: 'motion sensor %1',
      args0: [
        dropdown('READING', [
          ['tilt X (acceleration g)', 'AX'],
          ['tilt Y (acceleration g)', 'AY'],
          ['acceleration Z (g)', 'AZ'],
          ['rotation X (°/s)', 'GX'],
          ['rotation Y (°/s)', 'GY'],
          ['rotation Z (°/s)', 'GZ'],
          ['temperature (°C)', 'TEMP'],
        ]),
      ],
      output: 'Number',
      style: STYLE,
      tooltip: 'MPU6050 accelerometer and gyroscope on I²C (SDA/SCL), address 0x68.',
    },
  },
];

const value = (emit: (ctx: EmitContext) => [string, number], type: 'number' | 'boolean' = 'number'): Emitter => ({ kind: 'value', type, emit });

function dhtInstance(ctx: EmitContext): string {
  const pin = pinField(ctx, 'digital');
  const model = ctx.field('MODEL') === 'DHT22' ? 'DHT22' : 'DHT11';
  const name = `dht${model.slice(3)}_${pinId(pin)}`;
  include(ctx, 'DHT.h');
  ctx.contribute({ section: 'globals', key: `dht:${pin}`, code: `DHT ${name}(${pin}, ${model});`, priority: 20 });
  ctx.contribute({ section: 'setup.init', key: `dht:begin:${pin}`, code: `${name}.begin();`, priority: 20 });
  return name;
}

function colourHelper(ctx: EmitContext): void {
  ctx.contribute({
    section: 'functions',
    key: 'sensor:colour',
    priority: 20,
    code: [
      '// TCS3200: select a colour filter and measure the output pulse; shorter pulse = stronger colour.',
      'long tariroColour(uint8_t s2Level, uint8_t s3Level) {',
      '  digitalWrite(colourS2, s2Level);',
      '  digitalWrite(colourS3, s3Level);',
      '  delay(5);',
      '  unsigned long width = pulseIn(colourOut, LOW, 50000UL);',
      '  return width == 0 ? 0 : 100000L / (long)width;',
      '}',
    ].join('\n'),
  });
}

const MPU_REG: Record<string, [string, string]> = {
  AX: ['0x3B', ' / 16384.0'],
  AY: ['0x3D', ' / 16384.0'],
  AZ: ['0x3F', ' / 16384.0'],
  GX: ['0x43', ' / 131.0'],
  GY: ['0x45', ' / 131.0'],
  GZ: ['0x47', ' / 131.0'],
  TEMP: ['0x41', ' / 340.0 + 36.53'],
};

const emitters: Record<string, Emitter> = {
  sensor_button_pressed: value((ctx) => {
    const p = pinField(ctx, 'digital');
    pinMode(ctx, p, 'INPUT_PULLUP');
    return [`digitalRead(${p}) == LOW`, ORDER.EQUALITY];
  }, 'boolean'),
  sensor_analog_level: value((ctx) => [`map(analogRead(${pinField(ctx, 'analog')}), 0, ${adcMax(ctx)}, 0, 100)`, ORDER.ATOMIC]),
  sensor_detect: value((ctx) => {
    const p = pinField(ctx, 'digital');
    pinMode(ctx, p, 'INPUT');
    const active = DETECTORS[ctx.field('SENSOR')]?.active ?? 'HIGH';
    return [`digitalRead(${p}) == ${active}`, ORDER.EQUALITY];
  }, 'boolean'),
  sensor_dht: value((ctx) => {
    const name = dhtInstance(ctx);
    return [ctx.field('READING') === 'HUM' ? `${name}.readHumidity()` : `${name}.readTemperature()`, ORDER.POSTFIX];
  }),
  sensor_ultrasonic_cm: value((ctx) => {
    const trig = pinField(ctx, 'digital', 'TRIG');
    const echo = pinField(ctx, 'digital', 'ECHO');
    pinMode(ctx, trig, 'OUTPUT');
    pinMode(ctx, echo, 'INPUT');
    ctx.contribute({
      section: 'functions',
      key: 'sensor:ultrasonic',
      priority: 20,
      code: [
        '// HC-SR04: 10 µs trigger pulse, echo time → distance (sound travels ~0.0343 cm/µs, there and back).',
        'double tariroDistanceCm(uint8_t trig, uint8_t echo) {',
        '  digitalWrite(trig, LOW);',
        '  delayMicroseconds(2);',
        '  digitalWrite(trig, HIGH);',
        '  delayMicroseconds(10);',
        '  digitalWrite(trig, LOW);',
        '  unsigned long us = pulseIn(echo, HIGH, 30000UL);',
        '  return us * 0.0343 / 2.0;',
        '}',
      ].join('\n'),
    });
    return [`tariroDistanceCm(${trig}, ${echo})`, ORDER.ATOMIC];
  }),
  sensor_colour_setup: {
    kind: 'statement',
    emit: (ctx) => {
      const p = Object.fromEntries(['S0', 'S1', 'S2', 'S3', 'OUT'].map((k) => [k, pinField(ctx, 'digital', k)]));
      ctx.contribute({
        section: 'globals',
        key: 'sensor:colour:pins',
        code: `uint8_t colourS2 = ${p['S2']};\nuint8_t colourS3 = ${p['S3']};\nuint8_t colourOut = ${p['OUT']};`,
        priority: 20,
        override: true, // the set-up block's pins win over the read block's defaults
      });
      colourHelper(ctx);
      for (const k of ['S0', 'S1', 'S2', 'S3']) pinMode(ctx, p[k]!, 'OUTPUT');
      pinMode(ctx, p['OUT']!, 'INPUT');
      // 20 % output frequency scaling suits Arduino timing.
      return `digitalWrite(${p['S0']}, HIGH);\ndigitalWrite(${p['S1']}, LOW);`;
    },
  },
  sensor_colour_read: value((ctx) => {
    ctx.contribute({ section: 'globals', key: 'sensor:colour:pins', code: 'uint8_t colourS2 = 10;\nuint8_t colourS3 = 11;\nuint8_t colourOut = 12;', priority: 20 });
    colourHelper(ctx);
    const levels = { RED: 'LOW, LOW', GREEN: 'HIGH, HIGH', BLUE: 'LOW, HIGH' }[ctx.field('COLOUR')] ?? 'LOW, LOW';
    return [`tariroColour(${levels})`, ORDER.ATOMIC];
  }),
  sensor_mpu6050: value((ctx) => {
    include(ctx, 'Wire.h');
    ctx.contribute({ section: 'setup.init', key: 'wire:begin', code: 'Wire.begin();', priority: 5 });
    ctx.contribute({
      section: 'setup.init',
      key: 'mpu6050:wake',
      code: 'Wire.beginTransmission(0x68);\nWire.write(0x6B);\nWire.write(0);\nWire.endTransmission();',
      priority: 30,
    });
    ctx.contribute({
      section: 'functions',
      key: 'sensor:mpu6050',
      priority: 20,
      code: [
        '// Read one signed 16-bit register pair from the MPU6050 (address 0x68).',
        'double tariroMpuRaw(uint8_t reg) {',
        '  Wire.beginTransmission(0x68);',
        '  Wire.write(reg);',
        '  Wire.endTransmission(false);',
        '  Wire.requestFrom((uint8_t)0x68, (uint8_t)2);',
        '  if (Wire.available() < 2) return 0;',
        '  int16_t v = (Wire.read() << 8) | Wire.read();',
        '  return v;',
        '}',
      ].join('\n'),
    });
    const [reg, scale] = MPU_REG[ctx.field('READING')] ?? MPU_REG['AX']!;
    return [`tariroMpuRaw(${reg})${scale}`, ORDER.ADDITIVE];
  }),
};

export const sensorsExtension: ExtensionManifest = {
  id: 'sensors',
  name: 'Sensors',
  version: '0.1.0',
  category: 'sensors',
  kits: ['Starter', 'Robotics', 'IoT'],
  description: 'Buttons, potentiometer, light, soil, water and rain sensors, IR/PIR/sound detectors, DHT11, ultrasonic, colour and motion sensors.',
  boards: '*',
  libraries: [
    { name: 'DHT sensor library', version: '1.4.7' },
    { name: 'Adafruit Unified Sensor', version: '1.1.15' },
  ],
  blocks,
  emitters: { arduino: emitters },
  toolbox: [
    {
      id: 'sensors',
      name: 'Sensors',
      style: 'sensors_category',
      contents: [
        { kind: 'block', type: 'sensor_button_pressed' },
        { kind: 'block', type: 'sensor_analog_level' },
        { kind: 'block', type: 'sensor_detect' },
        { kind: 'sep' },
        { kind: 'block', type: 'sensor_dht' },
        { kind: 'block', type: 'sensor_ultrasonic_cm' },
        { kind: 'block', type: 'sensor_mpu6050' },
        { kind: 'sep' },
        { kind: 'block', type: 'sensor_colour_setup' },
        { kind: 'block', type: 'sensor_colour_read' },
      ],
    },
  ],
};

