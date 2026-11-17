/**
 * MicroPython emitters for the core language, pins, serial and Wi-Fi blocks (ESP32 boards).
 * Blocks without an emitter here show "not available in MicroPython yet" in the IDE.
 */
import { PY, stringLiteral, type EmitContext, type Emitter } from '@tariro-studio/core';

type V = Extract<Emitter, { kind: 'value' }>;
const value = (type: V['type'], emit: V['emit']): Emitter => ({ kind: 'value', type, emit });
const statement = (emit: (ctx: EmitContext) => string): Emitter => ({ kind: 'statement', emit });
export const imp = (ctx: EmitContext, line: string) => ctx.contribute({ section: 'includes', key: `import:${line}`, code: line });
export const helper = (ctx: EmitContext, key: string, code: string) => ctx.contribute({ section: 'functions', key, code, priority: 20 });
const num = (code: string) => (/^-?\d+(\.\d+)?$/.test(code) ? Number(code) : undefined);
const block = (head: string, body: string) => `${head}:\n${body}`;

const COMPARE: Record<string, string> = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };

export const coreMicroPython: Record<string, Emitter> = {
  tariro_on_start: { kind: 'root', bodyInput: 'DO', loopBlockType: 'tariro_forever', loopBodyInput: 'DO' },
  tariro_forever: statement((ctx) => block('while True', ctx.statements('DO'))),
  tariro_wait_seconds: statement((ctx) => {
    imp(ctx, 'import time');
    return `time.sleep(${ctx.value('SECONDS', PY.NONE, '1')})`;
  }),
  tariro_wait_ms: statement((ctx) => {
    imp(ctx, 'import time');
    const ms = ctx.value('MS', PY.NONE, '0');
    return /^\d+$/.test(ms) ? `time.sleep_ms(${ms})` : `time.sleep_ms(int(${ms}))`;
  }),
  tariro_millis: value('number', (ctx) => {
    imp(ctx, 'import time');
    return ['time.ticks_ms()', PY.POSTFIX];
  }),
  tariro_map: value('number', (ctx) => {
    helper(ctx, 'core:map', 'def tariro_map(x, in_low, in_high, out_low, out_high):\n    return (x - in_low) * (out_high - out_low) / (in_high - in_low) + out_low');
    return [`tariro_map(${['VALUE', 'FROM_LOW', 'FROM_HIGH', 'TO_LOW', 'TO_HIGH'].map((n) => ctx.value(n, PY.NONE, '0')).join(', ')})`, PY.POSTFIX];
  }),

  controls_if: statement((ctx) => {
    const st = ctx.extraState<{ elseIfCount?: number; hasElse?: boolean }>() ?? {};
    let code = block(`if ${ctx.value('IF0', PY.NONE, 'False')}`, ctx.statements('DO0'));
    for (let i = 1; i <= (st.elseIfCount ?? 0); i++) code += `\n${block(`elif ${ctx.value(`IF${i}`, PY.NONE, 'False')}`, ctx.statements(`DO${i}`))}`;
    if (st.hasElse) code += `\n${block('else', ctx.statements('ELSE'))}`;
    return code;
  }),
  controls_repeat_ext: statement((ctx) => block(`for ${ctx.temp('i')} in range(int(${ctx.value('TIMES', PY.NONE, '0')}))`, ctx.statements('DO'))),
  controls_whileUntil: statement((ctx) => {
    const cond = ctx.field('MODE') === 'UNTIL' ? `not ${ctx.value('BOOL', PY.NOT, 'False')}` : ctx.value('BOOL', PY.NONE, 'False');
    return block(`while ${cond}`, ctx.statements('DO'));
  }),
  controls_for: statement((ctx) => {
    helper(
      ctx,
      'core:count',
      'def tariro_count(start, stop, step):\n    # Count from start to stop (inclusive) in steps, up or down.\n    step = abs(step) or 1\n    if start <= stop:\n        while start <= stop:\n            yield start\n            start += step\n    else:\n        while start >= stop:\n            yield start\n            start -= step',
    );
    const v = ctx.variable('VAR').identifier;
    return block(`for ${v} in tariro_count(${ctx.value('FROM', PY.NONE, '0')}, ${ctx.value('TO', PY.NONE, '0')}, ${ctx.value('BY', PY.NONE, '1')})`, ctx.statements('DO'));
  }),
  controls_flow_statements: statement((ctx) => (ctx.field('FLOW') === 'CONTINUE' ? 'continue' : 'break')),

  logic_compare: value('boolean', (ctx) => [`${ctx.value('A', PY.COMPARISON, '0')} ${COMPARE[ctx.field('OP')] ?? '=='} ${ctx.value('B', PY.COMPARISON, '0')}`, PY.COMPARISON]),
  logic_operation: value('boolean', (ctx) => {
    const and = ctx.field('OP') === 'AND';
    const order = and ? PY.AND : PY.OR;
    const dflt = and ? 'True' : 'False';
    return [`${ctx.value('A', order + 0.5, dflt)} ${and ? 'and' : 'or'} ${ctx.value('B', order, dflt)}`, order];
  }),
  logic_negate: value('boolean', (ctx) => [`not ${ctx.value('BOOL', PY.NOT, 'False')}`, PY.NOT]),
  logic_boolean: value('boolean', (ctx) => [ctx.field('BOOL') === 'TRUE' ? 'True' : 'False', PY.ATOMIC]),
  logic_ternary: value('number', (ctx) => [`${ctx.value('THEN', PY.CONDITIONAL, '0')} if ${ctx.value('IF', PY.CONDITIONAL, 'False')} else ${ctx.value('ELSE', PY.CONDITIONAL, '0')}`, PY.CONDITIONAL]),

  math_number: value('number', (ctx) => {
    const n = Number(ctx.field('NUM'));
    const text = Number.isFinite(n) ? String(n) : '0';
    return [text, text.startsWith('-') ? PY.UNARY : PY.ATOMIC];
  }),
  math_arithmetic: value('number', (ctx) => {
    const op = ctx.field('OP');
    if (op === 'POWER') return [`${ctx.value('A', PY.POWER, '0')} ** ${ctx.value('B', PY.UNARY, '0')}`, PY.POWER];
    const [sym, order] = op === 'MULTIPLY' ? ['*', PY.MULTIPLICATIVE] : op === 'DIVIDE' ? ['/', PY.MULTIPLICATIVE] : op === 'MINUS' ? ['-', PY.ADDITIVE] : ['+', PY.ADDITIVE];
    return [`${ctx.value('A', order + 0.5, '0')} ${sym} ${ctx.value('B', order, op === 'DIVIDE' ? '1' : '0')}`, order];
  }),
  math_single: value('number', (ctx) => {
    const op = ctx.field('OP');
    if (op === 'NEG') return [`-${ctx.value('NUM', PY.UNARY, '0')}`, PY.UNARY];
    const x = ctx.value('NUM', PY.NONE, '0');
    if (op === 'ABS') return [`abs(${x})`, PY.POSTFIX];
    if (op === 'POW10') return [`10 ** ${ctx.value('NUM', PY.UNARY, '0')}`, PY.POWER];
    imp(ctx, 'import math');
    const fn = { ROOT: 'sqrt', LN: 'log', LOG10: 'log10', EXP: 'exp' }[op] ?? 'sqrt';
    return [`math.${fn}(${x})`, PY.POSTFIX];
  }),
  math_round: value('number', (ctx) => {
    const x = ctx.value('NUM', PY.NONE, '0');
    const op = ctx.field('OP');
    if (op === 'ROUND') return [`round(${x})`, PY.POSTFIX];
    imp(ctx, 'import math');
    return [`math.${op === 'ROUNDUP' ? 'ceil' : 'floor'}(${x})`, PY.POSTFIX];
  }),
  math_modulo: value('number', (ctx) => [`${ctx.value('DIVIDEND', PY.MULTIPLICATIVE + 0.5, '0')} % ${ctx.value('DIVISOR', PY.MULTIPLICATIVE, '1')}`, PY.MULTIPLICATIVE]),
  math_constrain: value('number', (ctx) => [`min(max(${ctx.value('VALUE', PY.NONE, '0')}, ${ctx.value('LOW', PY.NONE, '0')}), ${ctx.value('HIGH', PY.NONE, '0')})`, PY.POSTFIX]),
  math_random_int: value('number', (ctx) => {
    imp(ctx, 'import random');
    return [`random.randint(int(${ctx.value('FROM', PY.NONE, '0')}), int(${ctx.value('TO', PY.NONE, '0')}))`, PY.POSTFIX];
  }),
  math_change: statement((ctx) => `${ctx.variable('VAR').identifier} += ${ctx.value('DELTA', PY.NONE, '1')}`),

  text: value('string', (ctx) => [stringLiteral(ctx.field('TEXT')), PY.ATOMIC]),
  text_join: value('string', (ctx) => {
    const count = ctx.extraState<{ itemCount?: number }>()?.itemCount ?? 2;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) if (ctx.hasInput(`ADD${i}`)) parts.push(ctx.valueType(`ADD${i}`) === 'string' ? ctx.value(`ADD${i}`, PY.ADDITIVE, '""') : `str(${ctx.value(`ADD${i}`, PY.NONE, '""')})`);
    if (parts.length === 0) return ['""', PY.ATOMIC];
    return [parts.join(' + '), parts.length > 1 ? PY.ADDITIVE : PY.POSTFIX];
  }),
  text_length: value('number', (ctx) => [`len(str(${ctx.value('VALUE', PY.NONE, '""')}))`, PY.POSTFIX]),

  variables_get: value('number', (ctx) => [ctx.variable('VAR').identifier, PY.ATOMIC]),
  variables_set: statement((ctx) => `${ctx.variable('VAR').identifier} = ${ctx.value('VALUE', PY.NONE, '0')}`),

  procedures_defnoreturn: { kind: 'definition', emit: (ctx) => define(ctx, false) },
  procedures_defreturn: { kind: 'definition', emit: (ctx) => define(ctx, true) },
  procedures_callnoreturn: statement((ctx) => call(ctx)),
  procedures_callreturn: value('number', (ctx) => [call(ctx), PY.POSTFIX]),
  procedures_ifreturn: statement((ctx) => {
    const proc = ctx.currentProcedure;
    if (!proc) {
      ctx.warn('"if return" can only be used inside a function.');
      return '';
    }
    const ret = proc.returnType === 'void' ? 'return' : `return ${ctx.value('VALUE', PY.NONE, '0')}`;
    return `if ${ctx.value('CONDITION', PY.NONE, 'False')}:\n    ${ret}`;
  }),
};

function define(ctx: EmitContext, returns: boolean): void {
  const proc = ctx.procedure(ctx.field('NAME'));
  if (!proc) return;
  let body = ctx.statements('STACK');
  const ret = returns ? `    return ${ctx.value('RETURN', PY.NONE, '0')}` : '';
  if (ret) body = body.trim() === 'pass' ? ret : `${body}\n${ret}`;
  const globals = ctx.scopeDeclarations(); // after the body, so every variable it touches is known
  const head = `def ${proc.identifier}(${proc.params.map((p) => p.identifier).join(', ')}):`;
  ctx.contribute({ section: 'functions', key: `func:${proc.identifier}`, code: [head, globals, body].filter(Boolean).join('\n'), priority: 100 });
}

function call(ctx: EmitContext): string {
  const name = ctx.extraState<{ name?: string }>()?.name ?? '';
  const proc = ctx.procedure(name);
  if (!proc) {
    ctx.warn(`There is no function called "${name}".`);
    return 'None';
  }
  return `${proc.identifier}(${proc.params.map((_p, i) => ctx.value(`ARG${i}`, PY.NONE, '0')).join(', ')})`;
}

// ───────────────────────── pins and serial ─────────────────────────

/** The ESP32 core names ADC pins A0…A9 = GPIO1…GPIO10; MicroPython needs the GPIO number. */
export function gpio(ctx: EmitContext, field = 'PIN'): string {
  const pin = ctx.field(field);
  const analog = /^A(\d+)$/.exec(pin);
  const n = analog ? Number(analog[1]) + 1 : Number(pin);
  if (!Number.isInteger(n) || n < 0) {
    ctx.warn(`Pin ${pin} is not a GPIO number.`);
    return '0';
  }
  return String(n);
}

export function pinObject(ctx: EmitContext, n: string, mode: 'OUT' | 'IN' | 'IN_PULLUP'): string {
  imp(ctx, 'from machine import Pin');
  const name = `pin${n}_${mode === 'OUT' ? 'out' : 'in'}`;
  const args = mode === 'OUT' ? 'Pin.OUT' : mode === 'IN' ? 'Pin.IN' : 'Pin.IN, Pin.PULL_UP';
  ctx.contribute({ section: 'globals', key: `pin:${name}`, code: `${name} = Pin(${n}, ${args})`, priority: 20, override: mode === 'IN_PULLUP' });
  return name;
}

export function pwmObject(ctx: EmitContext, n: string): string {
  imp(ctx, 'from machine import Pin, PWM');
  ctx.contribute({ section: 'globals', key: `pwm:${n}`, code: `pwm${n} = PWM(Pin(${n}), freq=1000, duty=0)`, priority: 20 });
  return `pwm${n}`;
}

function stdinPoll(ctx: EmitContext): void {
  imp(ctx, 'import select');
  imp(ctx, 'import sys');
  ctx.contribute({ section: 'globals', key: 'serial:poll', code: 'serial_poll = select.poll()\nserial_poll.register(sys.stdin, select.POLLIN)', priority: 20 });
}

export const ioMicroPython: Record<string, Emitter> = {
  io_digital_write: statement((ctx) => `${pinObject(ctx, gpio(ctx), 'OUT')}.value(${ctx.field('STATE') === 'LOW' ? 0 : 1})`),
  io_digital_read: value('boolean', (ctx) => [`${pinObject(ctx, gpio(ctx), ctx.field('PULL') === 'INPUT_PULLUP' ? 'IN_PULLUP' : 'IN')}.value() == 1`, PY.COMPARISON]),
  io_analog_read: value('number', (ctx) => {
    imp(ctx, 'from machine import Pin, ADC');
    const n = gpio(ctx);
    ctx.contribute({ section: 'globals', key: `adc:${n}`, code: `adc${n} = ADC(Pin(${n}))\nadc${n}.atten(ADC.ATTN_11DB)`, priority: 20 });
    return [`adc${n}.read()`, PY.POSTFIX];
  }),
  io_pwm_write: statement((ctx) => {
    const level = ctx.value('VALUE', PY.NONE, '0');
    const lit = num(level);
    // Blocks use 0–255 like Arduino; ESP32 MicroPython duty is 0–1023.
    const duty = lit !== undefined ? String(Math.round((Math.min(Math.max(lit, 0), 255) * 1023) / 255)) : `int(min(max(${level}, 0), 255) * 1023 / 255)`;
    return `${pwmObject(ctx, gpio(ctx))}.duty(${duty})`;
  }),
  io_tone: statement((ctx) => {
    imp(ctx, 'import time');
    imp(ctx, 'from machine import Pin, PWM');
    helper(ctx, 'io:tone', 'def tariro_tone(pin, frequency, duration_ms):\n    # Play a note on a buzzer, then stop.\n    buzzer = PWM(Pin(pin), freq=int(frequency), duty=512)\n    time.sleep_ms(int(duration_ms))\n    buzzer.deinit()');
    return `tariro_tone(${gpio(ctx)}, ${ctx.value('FREQUENCY', PY.NONE, '440')}, ${ctx.value('DURATION', PY.NONE, '500')})`;
  }),
  io_no_tone: statement((ctx) => {
    imp(ctx, 'from machine import Pin, PWM');
    return `PWM(Pin(${gpio(ctx)})).deinit()`;
  }),
  serial_print: statement((ctx) => (ctx.field('MODE') === 'print' ? `print(${ctx.value('VALUE', PY.NONE, '""')}, end="")` : `print(${ctx.value('VALUE', PY.NONE, '""')})`)),
  serial_available: value('boolean', (ctx) => {
    stdinPoll(ctx);
    return ['len(serial_poll.poll(0)) > 0', PY.COMPARISON];
  }),
  serial_read_line: value('string', (ctx) => {
    imp(ctx, 'import sys');
    return ['sys.stdin.readline().strip()', PY.POSTFIX];
  }),
};

// ───────────────────────── Wi-Fi ─────────────────────────

export const iotMicroPython: Record<string, Emitter> = {
  wifi_connect: statement((ctx) => {
    imp(ctx, 'import network');
    imp(ctx, 'import time');
    ctx.contribute({ section: 'globals', key: 'iot:wlan', code: 'wlan = network.WLAN(network.STA_IF)', priority: 20 });
    helper(
      ctx,
      'iot:wifi',
      'def tariro_wifi_connect(ssid, password):\n    # Join a Wi-Fi network, giving up after 15 s so the rest of the program still runs.\n    wlan.active(True)\n    if not wlan.isconnected():\n        wlan.connect(ssid, password)\n        start = time.ticks_ms()\n        while not wlan.isconnected() and time.ticks_diff(time.ticks_ms(), start) < 15000:\n            time.sleep_ms(250)\n    print("Wi-Fi connected: " + wlan.ifconfig()[0] if wlan.isconnected() else "Wi-Fi not connected")\n    return wlan.isconnected()',
    );
    return `tariro_wifi_connect(${ctx.value('SSID', PY.NONE, '""')}, ${ctx.value('PASSWORD', PY.NONE, '""')})`;
  }),
  wifi_connected: value('boolean', (ctx) => {
    imp(ctx, 'import network');
    ctx.contribute({ section: 'globals', key: 'iot:wlan', code: 'wlan = network.WLAN(network.STA_IF)', priority: 20 });
    return ['wlan.isconnected()', PY.POSTFIX];
  }),
  wifi_ip: value('string', (ctx) => {
    imp(ctx, 'import network');
    ctx.contribute({ section: 'globals', key: 'iot:wlan', code: 'wlan = network.WLAN(network.STA_IF)', priority: 20 });
    return ['wlan.ifconfig()[0]', PY.POSTFIX];
  }),
  http_get: value('string', (ctx) => {
    imp(ctx, 'import urequests');
    helper(
      ctx,
      'iot:http',
      'def tariro_http_get(url):\n    # HTTP GET; returns the body, or an empty text if the request fails.\n    try:\n        response = urequests.get(url)\n        body = response.text if response.status_code == 200 else ""\n        response.close()\n        return body\n    except Exception:\n        return ""',
    );
    return [`tariro_http_get(${ctx.value('URL', PY.NONE, '""')})`, PY.POSTFIX];
  }),
};
