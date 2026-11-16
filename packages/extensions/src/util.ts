import { isValidPin, ORDER, reservedPins, type EmitContext, type PinKind } from '@tariro-studio/core';

/** `{ … }` block body; `inner` is already indented by ctx.statements(). */
export const braces = (inner: string): string => (inner ? `{\n${inner}\n}` : '{\n}');

/** Numeric shadow for toolbox entries. */
export const num = (n: number) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
export const txt = (s: string) => ({ shadow: { type: 'text', fields: { TEXT: s } } });

/** Read a pin field, warn when the board lacks it or an onboard peripheral already uses it. */
export function pinField(ctx: EmitContext, kind: PinKind, field = 'PIN'): string {
  const pin = ctx.field(field);
  if (!isValidPin(ctx.board, kind, pin)) {
    ctx.warn(`Pin ${pin} is not a ${kind === 'pwm' ? 'PWM (~)' : kind} pin on ${ctx.board.name}.`);
  }
  const owner = reservedPins(ctx.board).get(pin);
  if (owner) ctx.warn(`Pin ${pin} is also used by ${owner} on ${ctx.board.name}.`);
  return pin;
}

export function pinMode(ctx: EmitContext, pin: string, mode: 'OUTPUT' | 'INPUT' | 'INPUT_PULLUP'): void {
  ctx.contribute({ section: 'setup.init', key: `pinMode:${pin}`, code: `pinMode(${pin}, ${mode});`, priority: 10 });
}

export function serialBegin(ctx: EmitContext): void {
  ctx.contribute({
    section: 'setup.init',
    key: 'serial:begin',
    code: `Serial.begin(${ctx.options.serialBaud});`,
    priority: 0,
  });
}

/** Literal number if the code is one, for constant folding. */
export function asNumberLiteral(code: string): number | undefined {
  return /^-?\d+(\.\d+)?$/.test(code) ? Number(code) : undefined;
}

export { ORDER };

// ───────── helpers shared by the kit packs ─────────

/** Blockly JSON for a board-aware pin dropdown. */
export const pinArg = (kind: PinKind, value: string, name = 'PIN') => ({ type: 'field_tariro_pin', name, pinKind: kind, value });
export const dropdown = (name: string, options: Array<[string, string]>) => ({ type: 'field_dropdown', name, options });
export const valueIn = (name: string, check?: string) => ({ type: 'input_value', name, ...(check ? { check } : {}) });
export const STATEMENT = { previousStatement: null, nextStatement: null, inputsInline: true } as const;

export function include(ctx: EmitContext, header: string): void {
  ctx.contribute({ section: 'includes', key: `include:${header}`, code: `#include <${header}>`, priority: 50 });
}

/** Full-scale analogRead value: 10-bit on AVR, 12-bit on ESP32. */
export const adcMax = (ctx: EmitContext): number => (ctx.board.family === 'esp32' ? 4095 : 1023);

/** A C++ identifier fragment for a pin ("A0" → "A0", "13" → "13"). */
export const pinId = (pin: string): string => pin.replace(/[^A-Za-z0-9]/g, '');
