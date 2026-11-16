/**
 * Tariro onboard peripherals. The TB6612FNG pin mapping comes from the board definition; while it
 * is a placeholder (`confirmed: false`, IDE_DESIGN.md D3) the generated sketch carries a #warning
 * and every motor block shows a warning in the IDE.
 */
import { ORDER, type EmitContext, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { num } from './util.js';
import { tariroLive } from './live.js';

const MOTOR_OPTIONS = [
  ['A (left)', 'A'],
  ['B (right)', 'B'],
];

const blocks: ExtensionManifest['blocks'] = [
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

const emitters: Record<string, Emitter> = {
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
        { kind: 'block', type: 'tariro_motor_run', inputs: { SPEED: num(60) } },
        { kind: 'block', type: 'tariro_motor_stop' },
      ],
    },
  ],
};
