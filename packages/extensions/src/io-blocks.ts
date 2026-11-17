/** Board pins (digital, PWM, analog, tone) and the USB serial port. */
import { ORDER, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { num, pinField, pinMode, serialBegin, txt } from './util.js';
import { ioMicroPython } from './micropython.js';
import { ioLive } from './live.js';

const pin = (kind: 'digital' | 'pwm' | 'analog', value: string, name = 'PIN') => ({ type: 'field_tariro_pin', name, pinKind: kind, value });
const stmt = { previousStatement: null, nextStatement: null, inputsInline: true };

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'io_digital_write',
    json: {
      type: 'io_digital_write',
      message0: 'set pin %1 to %2',
      args0: [pin('digital', '13'), { type: 'field_dropdown', name: 'STATE', options: [['HIGH (on)', 'HIGH'], ['LOW (off)', 'LOW']] }],
      ...stmt,
      style: 'pins_blocks',
      tooltip: 'Turn a digital pin on (5 V) or off (0 V), e.g. to light an LED.',
    },
  },
  {
    type: 'io_digital_read',
    json: {
      type: 'io_digital_read',
      message0: 'pin %1 is HIGH %2',
      args0: [
        pin('digital', '2'),
        { type: 'field_dropdown', name: 'PULL', options: [['', 'INPUT'], ['(with pull-up)', 'INPUT_PULLUP']] },
      ],
      output: 'Boolean',
      style: 'pins_blocks',
      tooltip: 'True when the digital pin reads HIGH. Use pull-up for a button wired to GND (pressed = LOW).',
    },
  },
  {
    type: 'io_analog_read',
    json: {
      type: 'io_analog_read',
      message0: 'read analog pin %1',
      args0: [pin('analog', 'A0')],
      output: 'Number',
      style: 'pins_blocks',
      tooltip: 'Read a voltage on an analog pin: 0–1023 on Arduino-type boards, 0–4095 on ESP32.',
    },
  },
  {
    type: 'io_pwm_write',
    json: {
      type: 'io_pwm_write',
      message0: 'set PWM pin %1 to %2',
      args0: [pin('pwm', '3'), { type: 'input_value', name: 'VALUE', check: 'Number' }],
      ...stmt,
      style: 'pins_blocks',
      tooltip: 'Set a PWM (~) pin to a level from 0 (off) to 255 (fully on), e.g. LED brightness.',
    },
  },
  {
    type: 'io_tone',
    json: {
      type: 'io_tone',
      message0: 'play tone on pin %1 at %2 Hz for %3 ms',
      args0: [
        pin('digital', '8'),
        { type: 'input_value', name: 'FREQUENCY', check: 'Number' },
        { type: 'input_value', name: 'DURATION', check: 'Number' },
      ],
      ...stmt,
      style: 'pins_blocks',
      tooltip: 'Play a note on a buzzer.',
    },
  },
  {
    type: 'io_no_tone',
    json: {
      type: 'io_no_tone',
      message0: 'stop tone on pin %1',
      args0: [pin('digital', '8')],
      ...stmt,
      style: 'pins_blocks',
    },
  },
  {
    type: 'serial_print',
    json: {
      type: 'serial_print',
      message0: 'serial %1 %2',
      args0: [
        { type: 'field_dropdown', name: 'MODE', options: [['print line', 'println'], ['print', 'print']] },
        { type: 'input_value', name: 'VALUE' },
      ],
      ...stmt,
      style: 'serial_blocks',
      tooltip: 'Send text or a number to the computer (see it in the Serial Monitor).',
    },
  },
  {
    type: 'serial_available',
    json: {
      type: 'serial_available',
      message0: 'serial data received?',
      output: 'Boolean',
      style: 'serial_blocks',
    },
  },
  {
    type: 'serial_read_line',
    json: {
      type: 'serial_read_line',
      message0: 'serial read line',
      output: 'String',
      style: 'serial_blocks',
      tooltip: 'Read the text sent from the computer, up to the end of the line.',
    },
  },
];

const emitters: Record<string, Emitter> = {
  io_digital_write: {
    kind: 'statement',
    emit: (ctx) => {
      const p = pinField(ctx, 'digital');
      pinMode(ctx, p, 'OUTPUT');
      return `digitalWrite(${p}, ${ctx.field('STATE') === 'LOW' ? 'LOW' : 'HIGH'});`;
    },
  },
  io_digital_read: {
    kind: 'value',
    type: 'boolean',
    emit: (ctx) => {
      const p = pinField(ctx, 'digital');
      pinMode(ctx, p, ctx.field('PULL') === 'INPUT_PULLUP' ? 'INPUT_PULLUP' : 'INPUT');
      return [`digitalRead(${p}) == HIGH`, ORDER.EQUALITY];
    },
  },
  io_analog_read: {
    kind: 'value',
    type: 'number',
    emit: (ctx) => [`analogRead(${pinField(ctx, 'analog')})`, ORDER.ATOMIC],
  },
  io_pwm_write: {
    kind: 'statement',
    emit: (ctx) => {
      const p = pinField(ctx, 'pwm');
      pinMode(ctx, p, 'OUTPUT');
      return `analogWrite(${p}, ${ctx.value('VALUE', ORDER.COMMA, '0')});`;
    },
  },
  io_tone: {
    kind: 'statement',
    emit: (ctx) => {
      const p = pinField(ctx, 'digital');
      return `tone(${p}, ${ctx.value('FREQUENCY', ORDER.COMMA, '440')}, ${ctx.value('DURATION', ORDER.COMMA, '500')});`;
    },
  },
  io_no_tone: { kind: 'statement', emit: (ctx) => `noTone(${pinField(ctx, 'digital')});` },
  serial_print: {
    kind: 'statement',
    emit: (ctx) => {
      serialBegin(ctx);
      const fn = ctx.field('MODE') === 'print' ? 'print' : 'println';
      return `Serial.${fn}(${ctx.value('VALUE', ORDER.NONE, '""')});`;
    },
  },
  serial_available: {
    kind: 'value',
    type: 'boolean',
    emit: (ctx) => {
      serialBegin(ctx);
      return ['Serial.available() > 0', ORDER.RELATIONAL];
    },
  },
  serial_read_line: {
    kind: 'value',
    type: 'string',
    emit: (ctx) => {
      serialBegin(ctx);
      return ["Serial.readStringUntil('\\n')", ORDER.POSTFIX];
    },
  },
};

export const ioExtension: ExtensionManifest = {
  id: 'io',
  name: 'Pins & Serial',
  version: '0.1.0',
  category: 'io',
  description: 'Digital and analog pins, PWM, tones and the USB serial port.',
  boards: '*',
  blocks,
  emitters: { arduino: emitters, micropython: ioMicroPython },
  live: ioLive,
  toolbox: [
    {
      id: 'pins',
      name: 'Pins',
      style: 'pins_category',
      contents: [
        { kind: 'block', type: 'io_digital_write' },
        { kind: 'block', type: 'io_digital_read' },
        { kind: 'block', type: 'io_analog_read' },
        { kind: 'block', type: 'io_pwm_write', level: 'intermediate', inputs: { VALUE: num(128) } },
        { kind: 'sep' },
        { kind: 'block', type: 'io_tone', inputs: { FREQUENCY: num(440), DURATION: num(500) } },
        { kind: 'block', type: 'io_no_tone', level: 'intermediate' },
      ],
    },
    {
      id: 'serial',
      name: 'Serial',
      level: 'intermediate',
      style: 'serial_category',
      contents: [
        { kind: 'block', type: 'serial_print', inputs: { VALUE: txt('Hello Tariro!') } },
        { kind: 'block', type: 'serial_available', level: 'advanced' },
        { kind: 'block', type: 'serial_read_line', level: 'advanced' },
      ],
    },
  ],
};
