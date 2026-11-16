/**
 * Core language: program start, control flow, logic, maths, text, variables and functions.
 * Built-in Blockly blocks are reused for the language constructs (their definitions ship with
 * Blockly, Apache-2.0); every Arduino emitter below is our own.
 */
import { cppType, defaultValue, numberLiteral, ORDER, stringLiteral, type Emitter, type ExtensionManifest, type ValueType } from '@tariro-studio/core';
import { asNumberLiteral, braces, num, txt } from './util.js';
import { coreMicroPython } from './micropython.js';
import { coreLive } from './live.js';

const TIMES = { TIMES: num(10) };

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'tariro_on_start',
    json: {
      type: 'tariro_on_start',
      message0: 'when board starts up %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      style: 'events_blocks',
      hat: 'cap',
      tooltip: 'The program starts here. Blocks inside run once; put a "forever" loop last to repeat.',
    },
  },
  {
    type: 'tariro_forever',
    json: {
      type: 'tariro_forever',
      message0: 'forever %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      style: 'loop_blocks',
      tooltip: 'Repeat the blocks inside for as long as the board is powered.',
    },
  },
  {
    type: 'tariro_wait_seconds',
    json: {
      type: 'tariro_wait_seconds',
      message0: 'wait %1 seconds',
      args0: [{ type: 'input_value', name: 'SECONDS', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'loop_blocks',
      tooltip: 'Pause the program.',
    },
  },
  {
    type: 'tariro_wait_ms',
    json: {
      type: 'tariro_wait_ms',
      message0: 'wait %1 milliseconds',
      args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'loop_blocks',
      tooltip: 'Pause the program (1000 milliseconds = 1 second).',
    },
  },
  {
    type: 'tariro_millis',
    json: {
      type: 'tariro_millis',
      message0: 'milliseconds since start',
      output: 'Number',
      style: 'loop_blocks',
      tooltip: 'How long the board has been running, in milliseconds.',
    },
  },
  {
    type: 'tariro_map',
    json: {
      type: 'tariro_map',
      message0: 'map %1 from %2 – %3 to %4 – %5',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'input_value', name: 'FROM_LOW', check: 'Number' },
        { type: 'input_value', name: 'FROM_HIGH', check: 'Number' },
        { type: 'input_value', name: 'TO_LOW', check: 'Number' },
        { type: 'input_value', name: 'TO_HIGH', check: 'Number' },
      ],
      inputsInline: true,
      output: 'Number',
      style: 'math_blocks',
      tooltip: 'Re-scale a number from one range to another (e.g. 0–1023 to 0–255).',
    },
  },
  ...[
    'controls_if',
    'controls_repeat_ext',
    'controls_whileUntil',
    'controls_for',
    'controls_flow_statements',
    'logic_compare',
    'logic_operation',
    'logic_negate',
    'logic_boolean',
    'logic_ternary',
    'math_number',
    'math_arithmetic',
    'math_single',
    'math_round',
    'math_modulo',
    'math_constrain',
    'math_random_int',
    'math_change',
    'text',
    'text_join',
    'text_length',
    'variables_get',
    'variables_set',
    'procedures_defnoreturn',
    'procedures_defreturn',
    'procedures_callnoreturn',
    'procedures_callreturn',
    'procedures_ifreturn',
  ].map((type) => ({ type, builtin: true })),
];

const value = (
  type: ValueType | Extract<Emitter, { kind: 'value' }>['type'],
  emit: Extract<Emitter, { kind: 'value' }>['emit'],
): Emitter => ({ kind: 'value', type, emit });
const statement = (emit: Extract<Emitter, { kind: 'statement' }>['emit']): Emitter => ({ kind: 'statement', emit });

const COMPARE: Record<string, [string, number]> = {
  EQ: ['==', ORDER.EQUALITY],
  NEQ: ['!=', ORDER.EQUALITY],
  LT: ['<', ORDER.RELATIONAL],
  LTE: ['<=', ORDER.RELATIONAL],
  GT: ['>', ORDER.RELATIONAL],
  GTE: ['>=', ORDER.RELATIONAL],
};

const emitters: Record<string, Emitter> = {
  tariro_on_start: { kind: 'root', bodyInput: 'DO', loopBlockType: 'tariro_forever', loopBodyInput: 'DO' },
  tariro_forever: statement((ctx) => `while (true) ${braces(ctx.statements('DO'))}`),
  tariro_wait_seconds: statement((ctx) => {
    const s = ctx.value('SECONDS', ORDER.MULTIPLICATIVE, '1');
    const lit = asNumberLiteral(s);
    return lit !== undefined ? `delay(${Math.round(lit * 1000)});` : `delay(${s} * 1000);`;
  }),
  tariro_wait_ms: statement((ctx) => `delay(${ctx.value('MS', ORDER.NONE, '0')});`),
  tariro_millis: value('number', () => ['millis()', ORDER.ATOMIC]),
  tariro_map: value('number', (ctx) => [
    `map(${['VALUE', 'FROM_LOW', 'FROM_HIGH', 'TO_LOW', 'TO_HIGH'].map((n) => ctx.value(n, ORDER.COMMA, '0')).join(', ')})`,
    ORDER.ATOMIC,
  ]),

  // ── control ──
  controls_if: statement((ctx) => {
    const st = ctx.extraState<{ elseIfCount?: number; hasElse?: boolean }>() ?? {};
    let code = `if (${ctx.value('IF0', ORDER.NONE, 'false')}) ${braces(ctx.statements('DO0'))}`;
    for (let i = 1; i <= (st.elseIfCount ?? 0); i++)
      code += ` else if (${ctx.value(`IF${i}`, ORDER.NONE, 'false')}) ${braces(ctx.statements(`DO${i}`))}`;
    if (st.hasElse) code += ` else ${braces(ctx.statements('ELSE'))}`;
    return code;
  }),
  controls_repeat_ext: statement((ctx) => {
    const i = ctx.temp('i');
    return `for (int ${i} = 0; ${i} < ${ctx.value('TIMES', ORDER.RELATIONAL, '0')}; ${i}++) ${braces(ctx.statements('DO'))}`;
  }),
  controls_whileUntil: statement((ctx) => {
    const until = ctx.field('MODE') === 'UNTIL';
    const cond = until ? `!${ctx.value('BOOL', ORDER.UNARY, 'false')}` : ctx.value('BOOL', ORDER.NONE, 'false');
    return `while (${cond}) ${braces(ctx.statements('DO'))}`;
  }),
  controls_for: statement((ctx) => {
    const v = ctx.variable('VAR').identifier;
    const from = ctx.value('FROM', ORDER.ASSIGNMENT, '0');
    const to = ctx.value('TO', ORDER.RELATIONAL, '0');
    const by = ctx.value('BY', ORDER.ASSIGNMENT, '1');
    const step = asNumberLiteral(by);
    const header =
      step !== undefined
        ? step >= 0
          ? `${v} = ${from}; ${v} <= ${to}; ${v} += ${by}`
          : `${v} = ${from}; ${v} >= ${to}; ${v} -= ${numberLiteral(-step)}`
        : `${v} = ${from}; (${by}) >= 0 ? ${v} <= ${to} : ${v} >= ${to}; ${v} += ${by}`;
    return `for (${header}) ${braces(ctx.statements('DO'))}`;
  }),
  controls_flow_statements: statement((ctx) => (ctx.field('FLOW') === 'CONTINUE' ? 'continue;' : 'break;')),

  // ── logic ──
  logic_compare: value('boolean', (ctx) => {
    const [op, order] = COMPARE[ctx.field('OP')] ?? COMPARE['EQ']!;
    return [`${ctx.value('A', order, '0')} ${op} ${ctx.value('B', order, '0')}`, order];
  }),
  logic_operation: value('boolean', (ctx) => {
    const and = ctx.field('OP') === 'AND';
    const order = and ? ORDER.LOGICAL_AND : ORDER.LOGICAL_OR;
    const dflt = and ? 'true' : 'false';
    return [`${ctx.value('A', order, dflt)} ${and ? '&&' : '||'} ${ctx.value('B', order, dflt)}`, order];
  }),
  logic_negate: value('boolean', (ctx) => [`!${ctx.value('BOOL', ORDER.UNARY, 'false')}`, ORDER.UNARY]),
  logic_boolean: value('boolean', (ctx) => [ctx.field('BOOL') === 'TRUE' ? 'true' : 'false', ORDER.ATOMIC]),
  logic_ternary: value(
    (ctx) => ctx.valueType('THEN') ?? ctx.valueType('ELSE') ?? 'number',
    (ctx) => [
      `${ctx.value('IF', ORDER.CONDITIONAL, 'false')} ? ${ctx.value('THEN', ORDER.CONDITIONAL, '0')} : ${ctx.value('ELSE', ORDER.CONDITIONAL, '0')}`,
      ORDER.CONDITIONAL,
    ],
  ),

  // ── math ──
  math_number: value('number', (ctx) => {
    const n = numberLiteral(ctx.field('NUM'));
    return [n, n.startsWith('-') ? ORDER.UNARY : ORDER.ATOMIC];
  }),
  math_arithmetic: value('number', (ctx) => {
    const op = ctx.field('OP');
    if (op === 'POWER') return [`pow(${ctx.value('A', ORDER.COMMA, '0')}, ${ctx.value('B', ORDER.COMMA, '0')})`, ORDER.ATOMIC];
    if (op === 'DIVIDE')
      // (double) keeps 7 / 2 = 3.5 as learners expect, instead of C++ integer division.
      return [`(double)${ctx.value('A', ORDER.UNARY, '0')} / ${ctx.value('B', ORDER.MULTIPLICATIVE, '1')}`, ORDER.MULTIPLICATIVE];
    const [sym, order] =
      op === 'MULTIPLY' ? ['*', ORDER.MULTIPLICATIVE] : op === 'MINUS' ? ['-', ORDER.ADDITIVE] : ['+', ORDER.ADDITIVE];
    // Left-associative: (a + b) + c needs no parentheses, a - (b - c) keeps them.
    return [`${ctx.value('A', order + 0.5, '0')} ${sym} ${ctx.value('B', order, '0')}`, order];
  }),
  math_single: value('number', (ctx) => {
    const op = ctx.field('OP');
    if (op === 'NEG') return [`-${ctx.value('NUM', ORDER.UNARY, '0')}`, ORDER.UNARY];
    const x = ctx.value('NUM', ORDER.NONE, '0');
    const fn: Record<string, string> = { ROOT: `sqrt(${x})`, ABS: `fabs(${x})`, LN: `log(${x})`, LOG10: `log10(${x})`, EXP: `exp(${x})`, POW10: `pow(10, ${x})` };
    return [fn[op] ?? `fabs(${x})`, ORDER.ATOMIC];
  }),
  math_round: value('number', (ctx) => {
    const fn = { ROUND: 'round', ROUNDUP: 'ceil', ROUNDDOWN: 'floor' }[ctx.field('OP')] ?? 'round';
    return [`${fn}(${ctx.value('NUM', ORDER.NONE, '0')})`, ORDER.ATOMIC];
  }),
  math_modulo: value('number', (ctx) => [
    `fmod(${ctx.value('DIVIDEND', ORDER.COMMA, '0')}, ${ctx.value('DIVISOR', ORDER.COMMA, '1')})`,
    ORDER.ATOMIC,
  ]),
  math_constrain: value('number', (ctx) => [
    `constrain(${ctx.value('VALUE', ORDER.COMMA, '0')}, ${ctx.value('LOW', ORDER.COMMA, '0')}, ${ctx.value('HIGH', ORDER.COMMA, '0')})`,
    ORDER.ATOMIC,
  ]),
  math_random_int: value('number', (ctx) => [
    // Arduino random(min, max) excludes max; the block includes it.
    `random(${ctx.value('FROM', ORDER.COMMA, '0')}, ${ctx.value('TO', ORDER.ADDITIVE, '0')} + 1)`,
    ORDER.ATOMIC,
  ]),
  math_change: statement((ctx) => `${ctx.variable('VAR').identifier} += ${ctx.value('DELTA', ORDER.ASSIGNMENT, '1')};`),

  // ── text ──
  text: value('string', (ctx) => [stringLiteral(ctx.field('TEXT')), ORDER.ATOMIC]),
  text_join: value('string', (ctx) => {
    const count = ctx.extraState<{ itemCount?: number }>()?.itemCount ?? 2;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) if (ctx.hasInput(`ADD${i}`)) parts.push(`String(${ctx.value(`ADD${i}`, ORDER.NONE, '""')})`);
    if (parts.length === 0) return ['String("")', ORDER.ATOMIC];
    return [parts.join(' + '), parts.length > 1 ? ORDER.ADDITIVE : ORDER.ATOMIC];
  }),
  text_length: value('number', (ctx) => [`String(${ctx.value('VALUE', ORDER.NONE, '""')}).length()`, ORDER.POSTFIX]),

  // ── variables ──
  variables_get: value(
    (ctx) => ctx.variable('VAR').type,
    (ctx) => [ctx.variable('VAR').identifier, ORDER.ATOMIC],
  ),
  variables_set: statement((ctx) => {
    const v = ctx.variable('VAR');
    return `${v.identifier} = ${ctx.value('VALUE', ORDER.ASSIGNMENT, defaultValue(v.type))};`;
  }),

  // ── functions ──
  procedures_defnoreturn: { kind: 'definition', emit: (ctx) => defineProcedure(ctx, false) },
  procedures_defreturn: { kind: 'definition', emit: (ctx) => defineProcedure(ctx, true) },
  procedures_callnoreturn: statement((ctx) => `${callProcedure(ctx)};`),
  procedures_callreturn: value(
    (ctx) => {
      const r = ctx.procedure(ctx.extraState<{ name?: string }>()?.name ?? '')?.returnType;
      return r && r !== 'void' ? r : 'number';
    },
    (ctx) => [callProcedure(ctx), ORDER.ATOMIC],
  ),
  procedures_ifreturn: statement((ctx) => {
    const proc = ctx.currentProcedure;
    if (!proc) {
      ctx.warn('"if return" can only be used inside a function.');
      return '';
    }
    const ret =
      proc.returnType === 'void' ? 'return;' : `return ${ctx.value('VALUE', ORDER.NONE, defaultValue(proc.returnType))};`;
    return `if (${ctx.value('CONDITION', ORDER.NONE, 'false')}) {\n  ${ret}\n}`;
  }),
};

function signature(ctx: Parameters<Extract<Emitter, { kind: 'definition' }>['emit']>[0]): string | undefined {
  const proc = ctx.procedure(ctx.field('NAME'));
  if (!proc) return undefined;
  const params = proc.params.map((p) => `${cppType(p.type)} ${p.identifier}`).join(', ');
  return `${cppType(proc.returnType)} ${proc.identifier}(${params})`;
}

function defineProcedure(ctx: Parameters<Extract<Emitter, { kind: 'definition' }>['emit']>[0], returns: boolean): void {
  const proc = ctx.procedure(ctx.field('NAME'));
  const sig = signature(ctx);
  if (!proc || !sig) return;
  const body = ctx.statements('STACK');
  const ret =
    returns && proc.returnType !== 'void'
      ? `  return ${ctx.value('RETURN', ORDER.NONE, defaultValue(proc.returnType))};`
      : '';
  const inner = [body, ret].filter(Boolean).join('\n');
  ctx.contribute({ section: 'globals', key: `proto:${proc.identifier}`, code: `${sig};`, priority: 90 });
  ctx.contribute({ section: 'functions', key: `func:${proc.identifier}`, code: `${sig} ${braces(inner)}`, priority: 100 });
}

function callProcedure(ctx: Parameters<Extract<Emitter, { kind: 'statement' }>['emit']>[0]): string {
  const name = ctx.extraState<{ name?: string }>()?.name ?? '';
  const proc = ctx.procedure(name);
  if (!proc) {
    ctx.warn(`There is no function called "${name}".`);
    return `/* missing function ${name} */ (void)0`;
  }
  const args = proc.params.map((p, i) => ctx.value(`ARG${i}`, ORDER.COMMA, defaultValue(p.type)));
  return `${proc.identifier}(${args.join(', ')})`;
}

export const coreExtension: ExtensionManifest = {
  id: 'core',
  name: 'Core',
  version: '0.1.0',
  category: 'core',
  description: 'Program start, loops, decisions, maths, text, variables and functions.',
  boards: '*',
  blocks,
  emitters: { arduino: emitters, micropython: coreMicroPython },
  live: coreLive,
  toolbox: [
    {
      id: 'events',
      name: 'Start',
      style: 'events_category',
      contents: [{ kind: 'block', type: 'tariro_on_start' }],
    },
    {
      id: 'control',
      name: 'Control',
      style: 'loop_category',
      contents: [
        { kind: 'block', type: 'tariro_forever' },
        { kind: 'block', type: 'controls_repeat_ext', inputs: TIMES },
        { kind: 'block', type: 'tariro_wait_seconds', inputs: { SECONDS: num(1) } },
        { kind: 'block', type: 'tariro_wait_ms', inputs: { MS: num(500) } },
        { kind: 'sep' },
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'block', type: 'controls_for', inputs: { FROM: num(1), TO: num(10), BY: num(1) } },
        { kind: 'block', type: 'controls_flow_statements' },
        { kind: 'sep' },
        { kind: 'block', type: 'tariro_millis' },
      ],
    },
    {
      id: 'operators',
      name: 'Operators',
      style: 'math_category',
      contents: [
        { kind: 'block', type: 'math_arithmetic', inputs: { A: num(1), B: num(1) } },
        { kind: 'block', type: 'math_random_int', inputs: { FROM: num(1), TO: num(10) } },
        { kind: 'sep' },
        { kind: 'block', type: 'logic_compare', inputs: { A: num(0), B: num(50) } },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'logic_ternary' },
        { kind: 'sep' },
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_single', inputs: { NUM: num(9) } },
        { kind: 'block', type: 'math_round', inputs: { NUM: num(3.1) } },
        { kind: 'block', type: 'math_modulo', inputs: { DIVIDEND: num(64), DIVISOR: num(10) } },
        { kind: 'block', type: 'math_constrain', inputs: { VALUE: num(50), LOW: num(1), HIGH: num(100) } },
        {
          kind: 'block',
          type: 'tariro_map',
          inputs: { VALUE: num(512), FROM_LOW: num(0), FROM_HIGH: num(1023), TO_LOW: num(0), TO_HIGH: num(255) },
        },
      ],
    },
    { id: 'variables', name: 'Variables', style: 'variable_category', custom: 'VARIABLE', contents: [] },
    {
      id: 'text',
      name: 'Text',
      style: 'text_category',
      contents: [
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'text_join' },
        { kind: 'block', type: 'text_length', inputs: { VALUE: txt('Tariro') } },
      ],
    },
    { id: 'functions', name: 'My Blocks', style: 'procedure_category', custom: 'PROCEDURE', contents: [] },
  ],
};
