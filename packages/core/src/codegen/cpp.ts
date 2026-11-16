/** C++ helpers shared by the Arduino generator and emitters. */

/**
 * Operator precedence, tightest first (C++ standard order). An emitter returns the order of the
 * expression it produced; a caller asks for an input "at" the order of the slot it puts it in.
 */
export const ORDER = {
  ATOMIC: 0, // literals, identifiers, f(x), (x)
  POSTFIX: 1, // a[i], a.b
  UNARY: 2, // !a, -a, (double)a
  MULTIPLICATIVE: 3, // * / %
  ADDITIVE: 4, // + -
  SHIFT: 5,
  RELATIONAL: 6, // < <= > >=
  EQUALITY: 7, // == !=
  BITWISE_AND: 8,
  BITWISE_XOR: 9,
  BITWISE_OR: 10,
  LOGICAL_AND: 11,
  LOGICAL_OR: 12,
  CONDITIONAL: 13, // a ? b : c
  ASSIGNMENT: 14,
  COMMA: 15,
  NONE: 99, // the slot accepts any expression (argument, statement, initialiser)
} as const;

/** Wrap `code` in parentheses if it binds more weakly than the slot requires. */
export function wrap(code: string, inner: number, outer: number): string {
  if (inner === ORDER.ATOMIC || outer === ORDER.NONE) return code;
  return inner >= outer ? `(${code})` : code;
}

const RESERVED = new Set(
  `alignas alignof and and_eq asm auto bitand bitor bool break case catch char char16_t char32_t class compl
  const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export
  extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator
  or or_eq private protected public register reinterpret_cast return short signed sizeof static static_assert
  static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using
  virtual void volatile wchar_t while xor xor_eq
  setup loop main String Serial HIGH LOW INPUT OUTPUT INPUT_PULLUP LED_BUILTIN byte word boolean
  pinMode digitalWrite digitalRead analogRead analogWrite delay delayMicroseconds millis micros tone noTone
  map constrain random randomSeed abs min max sq sqrt pow sin cos tan log exp floor ceil round PI`.split(/\s+/),
);

/** Turn a learner-chosen name ("my speed", "2nd") into a valid, readable C++ identifier. */
export function sanitizeIdentifier(name: string): string {
  let id = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^A-Za-z0-9_]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''));
  if (id === '') id = 'item';
  if (/^[0-9]/.test(id)) id = `_${id}`;
  if (RESERVED.has(id)) id = `${id}_`;
  return id;
}

/** Allocates unique identifiers across a whole program. */
export class NameAllocator {
  private readonly used = new Set<string>();
  private readonly byKey = new Map<string, string>();

  /** Same key → same identifier. */
  get(key: string, name: string): string {
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const base = sanitizeIdentifier(name);
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}${n}`;
    this.used.add(id);
    this.byKey.set(key, id);
    return id;
  }

  /** Always a fresh identifier. */
  fresh(base: string): string {
    let id = sanitizeIdentifier(base);
    for (let n = 2; this.used.has(id); n++) id = `${sanitizeIdentifier(base)}${n}`;
    this.used.add(id);
    return id;
  }
}

/** Numeric literal as C++ source (integers stay integers). */
export function numberLiteral(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

/** Double-quoted C++ string literal. */
export function stringLiteral(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

export function cppType(t: 'number' | 'boolean' | 'string' | 'void'): string {
  return t === 'number' ? 'double' : t === 'boolean' ? 'bool' : t === 'string' ? 'String' : 'void';
}

export function defaultValue(t: 'number' | 'boolean' | 'string'): string {
  return t === 'number' ? '0' : t === 'boolean' ? 'false' : '""';
}

export const INDENT = '  ';

export function indent(code: string, prefix = INDENT): string {
  return code
    .split('\n')
    .map((l) => (l.length ? prefix + l : l))
    .join('\n');
}
