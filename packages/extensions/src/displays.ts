/** I²C 16×2 character LCD (Starter kit) and 0.96" SSD1306 OLED (IoT kit). */
import { ORDER, type EmitContext, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { dropdown, include, num, STATEMENT, txt, valueIn } from './util.js';

const STYLE = 'displays_blocks';

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'lcd_setup',
    json: {
      type: 'lcd_setup',
      message0: 'set up LCD 16×2 at I²C address %1',
      args0: [dropdown('ADDR', [['0x27', '0x27'], ['0x3F', '0x3F']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'I²C character LCD on SDA/SCL. Most modules use 0x27; try 0x3F if nothing shows.',
    },
  },
  {
    type: 'lcd_print',
    json: {
      type: 'lcd_print',
      message0: 'LCD write %1 at row %2 column %3',
      args0: [valueIn('TEXT'), dropdown('ROW', [['1', '0'], ['2', '1']]), valueIn('COL', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Write text or a number. Columns are 1–16.',
    },
  },
  {
    type: 'lcd_clear',
    json: { type: 'lcd_clear', message0: 'clear LCD', ...STATEMENT, style: STYLE },
  },
  {
    type: 'oled_setup',
    json: {
      type: 'oled_setup',
      message0: 'set up OLED 128×64 at I²C address %1',
      args0: [dropdown('ADDR', [['0x3C', '0x3C'], ['0x3D', '0x3D']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: '0.96" SSD1306 OLED on SDA/SCL.',
    },
  },
  {
    type: 'oled_print',
    json: {
      type: 'oled_print',
      message0: 'OLED write %1 at x %2 y %3 size %4',
      args0: [valueIn('TEXT'), valueIn('X', 'Number'), valueIn('Y', 'Number'), dropdown('SIZE', [['1', '1'], ['2', '2'], ['3', '3']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Write text at a position (x 0–127, y 0–63) and show it.',
    },
  },
  {
    type: 'oled_clear',
    json: { type: 'oled_clear', message0: 'clear OLED', ...STATEMENT, style: STYLE },
  },
];

function lcd(ctx: EmitContext, addr = '0x27', override = false): void {
  include(ctx, 'Wire.h');
  include(ctx, 'LiquidCrystal_I2C.h');
  ctx.contribute({ section: 'globals', key: 'lcd', code: `LiquidCrystal_I2C lcd(${addr}, 16, 2);`, priority: 20, override });
  ctx.contribute({ section: 'setup.init', key: 'lcd:init', code: 'lcd.init();\nlcd.backlight();', priority: 30 });
}

function oled(ctx: EmitContext, addr = '0x3C', override = false): void {
  include(ctx, 'Wire.h');
  include(ctx, 'Adafruit_GFX.h');
  include(ctx, 'Adafruit_SSD1306.h');
  ctx.contribute({ section: 'globals', key: 'oled', code: 'Adafruit_SSD1306 oled(128, 64, &Wire, -1);', priority: 20 });
  ctx.contribute({
    section: 'setup.init',
    key: 'oled:begin',
    code: `oled.begin(SSD1306_SWITCHCAPVCC, ${addr});\noled.clearDisplay();\noled.setTextColor(SSD1306_WHITE);\noled.display();`,
    priority: 30,
    override,
  });
}

const statement = (emit: (ctx: EmitContext) => string): Emitter => ({ kind: 'statement', emit });

const emitters: Record<string, Emitter> = {
  lcd_setup: statement((ctx) => {
    lcd(ctx, ctx.field('ADDR') === '0x3F' ? '0x3F' : '0x27', true);
    return '';
  }),
  lcd_print: statement((ctx) => {
    lcd(ctx);
    const col = ctx.value('COL', ORDER.ADDITIVE, '1');
    return `lcd.setCursor(constrain((int)(${col}) - 1, 0, 15), ${ctx.field('ROW') === '1' ? 1 : 0});\nlcd.print(${ctx.value('TEXT', ORDER.NONE, '""')});`;
  }),
  lcd_clear: statement((ctx) => {
    lcd(ctx);
    return 'lcd.clear();';
  }),
  oled_setup: statement((ctx) => {
    oled(ctx, ctx.field('ADDR') === '0x3D' ? '0x3D' : '0x3C', true);
    return '';
  }),
  oled_print: statement((ctx) => {
    oled(ctx);
    return [
      `oled.setTextSize(${Number(ctx.field('SIZE')) || 1});`,
      `oled.setCursor(${ctx.value('X', ORDER.COMMA, '0')}, ${ctx.value('Y', ORDER.COMMA, '0')});`,
      `oled.print(${ctx.value('TEXT', ORDER.NONE, '""')});`,
      'oled.display();',
    ].join('\n');
  }),
  oled_clear: statement((ctx) => {
    oled(ctx);
    return 'oled.clearDisplay();';
  }),
};

export const displaysExtension: ExtensionManifest = {
  id: 'displays',
  name: 'Displays',
  version: '0.1.0',
  category: 'displays',
  kits: ['Starter', 'IoT'],
  description: '16×2 I²C character LCD and 0.96" OLED screen.',
  boards: '*',
  libraries: [
    { name: 'LiquidCrystal I2C', version: '1.1.2' },
    { name: 'Adafruit SSD1306', version: '2.5.17' },
    { name: 'Adafruit GFX Library', version: '1.13.0' },
    { name: 'Adafruit BusIO', version: '1.17.4' },
  ],
  blocks,
  emitters: { arduino: emitters },
  toolbox: [
    {
      id: 'displays',
      name: 'Displays',
      style: 'displays_category',
      contents: [
        { kind: 'label', text: 'LCD 16×2' },
        { kind: 'block', type: 'lcd_setup' },
        { kind: 'block', type: 'lcd_print', inputs: { TEXT: txt('Hello!'), COL: num(1) } },
        { kind: 'block', type: 'lcd_clear' },
        { kind: 'label', text: 'OLED 128×64' },
        { kind: 'block', type: 'oled_setup' },
        { kind: 'block', type: 'oled_print', inputs: { TEXT: txt('Tariro'), X: num(0), Y: num(0) } },
        { kind: 'block', type: 'oled_clear' },
      ],
    },
  ],
};
