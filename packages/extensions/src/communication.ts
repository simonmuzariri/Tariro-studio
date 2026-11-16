/**
 * HM10 Bluetooth (BLE) serial module from the Robotics kit. AVR boards use SoftwareSerial on two
 * pins; ESP32 boards use their second hardware UART on the same pins.
 */
import { ORDER, type EmitContext, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { dropdown, include, pinArg, pinField, STATEMENT, txt, valueIn } from './util.js';

const STYLE = 'communication_blocks';

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'ble_setup',
    json: {
      type: 'ble_setup',
      message0: 'set up Bluetooth HM10: board RX %1 (to HM10 TX) board TX %2 (to HM10 RX) at %3 baud',
      args0: [pinArg('digital', '2', 'RX'), pinArg('digital', '3', 'TX'), dropdown('BAUD', [['9600', '9600'], ['115200', '115200']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Connect the HM10 module. Put this in "when board starts up".',
    },
  },
  {
    type: 'ble_send',
    json: {
      type: 'ble_send',
      message0: 'Bluetooth %1 %2',
      args0: [dropdown('MODE', [['send line', 'println'], ['send', 'print']]), valueIn('VALUE')],
      ...STATEMENT,
      style: STYLE,
    },
  },
  {
    type: 'ble_available',
    json: { type: 'ble_available', message0: 'Bluetooth data received?', output: 'Boolean', style: STYLE },
  },
  {
    type: 'ble_read_line',
    json: { type: 'ble_read_line', message0: 'Bluetooth read line', output: 'String', style: STYLE },
  },
];

/** Declares the `ble` port; the set-up block's pins override the defaults. */
function port(ctx: EmitContext, rx = '2', tx = '3', baud = '9600', fromSetup = false): void {
  if (ctx.board.family === 'esp32') {
    ctx.contribute({ section: 'globals', key: 'ble:port', code: 'HardwareSerial &ble = Serial1;', priority: 20 });
    ctx.contribute({ section: 'setup.init', key: 'ble:begin', code: `Serial1.begin(${baud}, SERIAL_8N1, ${rx}, ${tx});`, priority: 30, override: fromSetup });
  } else {
    include(ctx, 'SoftwareSerial.h');
    ctx.contribute({ section: 'globals', key: 'ble:port', code: `SoftwareSerial ble(${rx}, ${tx});`, priority: 20, override: fromSetup });
    ctx.contribute({ section: 'setup.init', key: 'ble:begin', code: `ble.begin(${baud});`, priority: 30, override: fromSetup });
  }
}

const emitters: Record<string, Emitter> = {
  ble_setup: {
    kind: 'statement',
    emit: (ctx) => {
      port(ctx, pinField(ctx, 'digital', 'RX'), pinField(ctx, 'digital', 'TX'), ctx.field('BAUD') === '115200' ? '115200' : '9600', true);
      return '';
    },
  },
  ble_send: {
    kind: 'statement',
    emit: (ctx) => {
      port(ctx);
      return `ble.${ctx.field('MODE') === 'print' ? 'print' : 'println'}(${ctx.value('VALUE', ORDER.NONE, '""')});`;
    },
  },
  ble_available: {
    kind: 'value',
    type: 'boolean',
    emit: (ctx) => {
      port(ctx);
      return ['ble.available() > 0', ORDER.RELATIONAL];
    },
  },
  ble_read_line: {
    kind: 'value',
    type: 'string',
    emit: (ctx) => {
      port(ctx);
      return ["ble.readStringUntil('\\n')", ORDER.POSTFIX];
    },
  },
};

export const communicationExtension: ExtensionManifest = {
  id: 'communication',
  name: 'Bluetooth (HM10)',
  version: '0.1.0',
  category: 'communication',
  kits: ['Robotics'],
  description: 'Send and receive text with a phone over the HM10 Bluetooth module.',
  boards: '*',
  blocks,
  emitters: { arduino: emitters },
  toolbox: [
    {
      id: 'communication',
      name: 'Bluetooth',
      style: 'communication_category',
      contents: [
        { kind: 'block', type: 'ble_setup' },
        { kind: 'block', type: 'ble_send', inputs: { VALUE: txt('Hello from Tariro') } },
        { kind: 'block', type: 'ble_available' },
        { kind: 'block', type: 'ble_read_line' },
      ],
    },
  ],
};
