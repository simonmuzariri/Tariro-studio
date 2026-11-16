import { describe, expect, it } from 'vitest';
import { generateArduino, getBoard, sanitizeIdentifier, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, STARTER_WORKSPACE } from '../src/index.js';
import { block, forever, n, program, set, t, v, wait, workspace } from '../src/build.js';

const registry = createRegistry();
const uno = getBoard('arduino-uno');
const tariro = getBoard('tariro');
const gen = (ws: WorkspaceJson, board = uno) => generateArduino(ws, board, registry);
const body = (code: string, fn: 'setup' | 'loop') => {
  const m = code.match(new RegExp(`void ${fn}\\(\\) \\{\\n([\\s\\S]*?)\\n?\\}`));
  return (m?.[1] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
};
const led = (state: 'HIGH' | 'LOW', pin = '13') => block('io_digital_write', { fields: { PIN: pin, STATE: state } });

describe('program layout', () => {
  it('starter workspace produces empty setup and loop without warnings', () => {
    const r = gen(STARTER_WORKSPACE);
    expect(body(r.code, 'setup')).toEqual([]);
    expect(body(r.code, 'loop')).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('puts blocks before a trailing forever in setup() and its body in loop()', () => {
    const r = gen(workspace([program(led('HIGH', '12'), forever(led('HIGH'), wait(0.25)))]));
    expect(body(r.code, 'setup')).toEqual(['pinMode(12, OUTPUT);', 'pinMode(13, OUTPUT);', 'digitalWrite(12, HIGH);']);
    expect(body(r.code, 'loop')).toEqual(['digitalWrite(13, HIGH);', 'delay(250);']);
  });

  it('without forever everything runs once in setup()', () => {
    const r = gen(workspace([program(led('HIGH'))]));
    expect(body(r.code, 'setup')).toContain('digitalWrite(13, HIGH);');
    expect(body(r.code, 'loop')).toEqual([]);
  });

  it('a forever that is not last becomes while (true)', () => {
    const inner = block('controls_repeat_ext', { inputs: { TIMES: n(2) }, do: { DO: [forever(led('LOW'))] } });
    const r = gen(workspace([program(inner, led('HIGH'))]));
    expect(r.code).toContain('while (true) {');
  });

  it('hoists and deduplicates pinMode', () => {
    const r = gen(workspace([program(forever(led('HIGH'), led('LOW'), led('HIGH')))]));
    expect(r.code.match(/pinMode\(13, OUTPUT\);/g)).toHaveLength(1);
  });

  it('warns about a missing start block, extra start blocks and loose blocks', () => {
    expect(gen(workspace([])).warnings.map((w) => w.message)).toContain(
      'Add a "when board starts up" block to give your program a starting point.',
    );
    const r = gen(workspace([program(), block('tariro_on_start', { id: 'second' }), led('HIGH')]));
    expect(r.warnings.find((w) => w.blockId === 'second')?.message).toMatch(/Only one/);
    expect(r.warnings.some((w) => /not inside/.test(w.message))).toBe(true);
    expect(r.code).not.toContain('digitalWrite');
  });

  it('skips disabled blocks', () => {
    const off = led('HIGH');
    off.enabled = false;
    expect(gen(workspace([program(off)])).code).not.toContain('digitalWrite');
  });
});

describe('expressions', () => {
  const expr = (value: ReturnType<typeof block>) =>
    body(gen(workspace([program(set('x', value))], [{ id: 'x', name: 'x' }])).code, 'setup').at(-1);

  it('adds parentheses only where precedence needs them', () => {
    const sum = block('math_arithmetic', { fields: { OP: 'ADD' }, inputs: { A: n(1), B: n(2) } });
    expect(expr(block('math_arithmetic', { fields: { OP: 'MULTIPLY' }, inputs: { A: sum, B: n(3) } }))).toBe('x = (1 + 2) * 3;');
    const sum2 = block('math_arithmetic', { fields: { OP: 'ADD' }, inputs: { A: n(1), B: n(2) } });
    expect(expr(block('math_arithmetic', { fields: { OP: 'ADD' }, inputs: { A: sum2, B: n(3) } }))).toBe('x = 1 + 2 + 3;');
    const diff = block('math_arithmetic', { fields: { OP: 'MINUS' }, inputs: { A: n(5), B: n(2) } });
    expect(expr(block('math_arithmetic', { fields: { OP: 'MINUS' }, inputs: { A: n(9), B: diff } }))).toBe('x = 9 - (5 - 2);');
  });

  it('divides as real numbers, not C++ integer division', () => {
    expect(expr(block('math_arithmetic', { fields: { OP: 'DIVIDE' }, inputs: { A: n(7), B: n(2) } }))).toBe('x = (double)7 / 2;');
  });

  it('random is inclusive of the upper bound', () => {
    expect(expr(block('math_random_int', { inputs: { FROM: n(1), TO: n(6) } }))).toBe('x = random(1, 6 + 1);');
  });

  it('negates comparisons with parentheses', () => {
    const cmp = block('logic_compare', { fields: { OP: 'LT' }, inputs: { A: n(1), B: n(2) } });
    expect(expr(block('logic_negate', { inputs: { BOOL: cmp } }))).toBe('x = !(1 < 2);');
  });
});

describe('variables and functions', () => {
  it('types variables from what is assigned to them', () => {
    const r = gen(
      workspace(
        [program(set('a', n(1)), set('b', t('hi')), set('c', block('logic_boolean', { fields: { BOOL: 'TRUE' } })))],
        [
          { id: 'a', name: 'a' },
          { id: 'b', name: 'b' },
          { id: 'c', name: 'c' },
        ],
      ),
    );
    expect(r.code).toContain('double a = 0;');
    expect(r.code).toContain('String b = "";');
    expect(r.code).toContain('bool c = false;');
  });

  it('turns learner names into valid, unique C++ identifiers', () => {
    expect(sanitizeIdentifier('light level')).toBe('lightLevel');
    expect(sanitizeIdentifier('2nd try')).toBe('_2ndTry');
    expect(sanitizeIdentifier('delay')).toBe('delay_');
    expect(sanitizeIdentifier('')).toBe('item');
    const r = gen(
      workspace([program(set('a', n(1)), set('b', n(2)))], [
        { id: 'a', name: 'speed!' },
        { id: 'b', name: 'speed?' },
      ]),
    );
    expect(r.code).toContain('double speed = 0;');
    expect(r.code).toContain('double speed2 = 0;');
  });

  it('declares functions with prototypes and does not make parameters global', () => {
    const def = block('procedures_defnoreturn', {
      fields: { NAME: 'flash' },
      extraState: { params: [{ name: 'pin count', id: 'p' }] },
      do: { STACK: [set('p', block('math_arithmetic', { fields: { OP: 'ADD' }, inputs: { A: v('p'), B: n(1) } }))] },
    });
    const call = block('procedures_callnoreturn', { extraState: { name: 'flash', params: ['pin count'] }, inputs: { ARG0: n(3) } });
    const r = gen(workspace([program(call), def], [{ id: 'p', name: 'pin count' }]));
    expect(r.code).toContain('void flash(double pinCount);');
    expect(r.code).toContain('void flash(double pinCount) {\n  pinCount = pinCount + 1;\n}');
    expect(r.code).toContain('flash(3);');
    expect(r.code).not.toContain('double pinCount = 0;');
  });
});

describe('boards and source map', () => {
  it('warns when a block is not available on the selected board', () => {
    const r = gen(workspace([program(block('tariro_motor_stop', { fields: { MOTOR: 'A' } }))]), uno);
    expect(r.warnings.some((w) => /does not work on Arduino Uno/.test(w.message))).toBe(true);
    expect(r.code).not.toContain('tariroMotorStop');
  });

  it('drives the Tariro (Malkon SMRS) motors with the confirmed direction/enable pins', () => {
    const r = gen(workspace([program(block('tariro_motor_run', { fields: { MOTOR: 'B', DIRECTION: 'BACKWARD' }, inputs: { SPEED: n(50) } }))]), tariro);
    expect(r.code).toContain('const uint8_t TARIRO_INA = 4;');
    expect(r.code).toContain('const uint8_t TARIRO_ENA = 5;');
    expect(r.code).toContain('const uint8_t TARIRO_INB = 7;');
    expect(r.code).toContain('const uint8_t TARIRO_ENB = 6;');
    expect(r.code).toContain("tariroMotor('B', false, 50);");
    expect(r.code).not.toContain('#warning');
    expect(r.warnings).toEqual([]);
  });

  it('flags an unconfirmed motor pin mapping in the code and the IDE', () => {
    const draft = { ...tariro, onboard: [{ ...tariro.onboard![0]!, confirmed: false }] };
    const r = gen(workspace([program(block('tariro_motor_stop', { fields: { MOTOR: 'A' } }))]), draft);
    expect(r.code).toContain('#warning');
    expect(r.warnings.some((w) => /placeholders/.test(w.message))).toBe(true);
  });

  it('supports two-input TB6612FNG wiring too', () => {
    const breakout = { ...tariro, onboard: [{ id: 'motorDriver', kind: 'dual-motor-driver' as const, confirmed: true, pins: { PWMA: 3, AIN1: 8, AIN2: 9, PWMB: 11, BIN1: 12, BIN2: 13 } }] };
    const r = gen(workspace([program(block('tariro_motor_stop', { fields: { MOTOR: 'BOTH' } }))]), breakout);
    expect(r.code).toContain('const uint8_t TARIRO_AIN2 = 9;');
    expect(r.code).toContain("digitalWrite(motor == 'A' ? TARIRO_AIN2 : TARIRO_BIN2, LOW);");
  });

  it('lists the Malkon boards', () => {
    expect(getBoard('malkon-one').fqbn).toBe('arduino:avr:uno');
    expect(getBoard('malkon-esp32s3')).toMatchObject({ family: 'esp32', fqbn: 'esp32:esp32:esp32s3' });
  });

  it('warns when a pin is invalid for the board or used by an onboard peripheral', () => {
    const r = gen(workspace([program(block('io_pwm_write', { fields: { PIN: '4' }, inputs: { VALUE: n(1) } }))]), tariro);
    const msgs = r.warnings.map((w) => w.message).join('\n');
    expect(msgs).toMatch(/not a PWM/);
    expect(msgs).toMatch(/also used by motorDriver/);
  });

  it('maps each statement line back to its block', () => {
    const on = block('io_digital_write', { id: 'ledOn', fields: { PIN: '13', STATE: 'HIGH' } });
    const r = gen(workspace([program(forever(on))]));
    const lines = r.code.split('\n');
    const entry = r.sourceMap.find((m) => m.blockId === 'ledOn');
    expect(entry).toBeDefined();
    expect(lines[entry!.line - 1]!.trim()).toBe('digitalWrite(13, HIGH);');
    const loop = r.sourceMap.find((m) => m.blockId === 'loop');
    expect(lines[loop!.line - 1]).toBe('void loop() {');
  });
});
