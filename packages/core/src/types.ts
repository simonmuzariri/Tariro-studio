/**
 * Tariro Studio — core contracts.
 * Pure TypeScript, no DOM/Node imports. See IDE_DESIGN.md for rationale.
 */

import type { LiveHandler } from './live/interpreter.js';

// ───────────────────────────── Boards ─────────────────────────────

export type BoardFamily = 'avr' | 'esp32';
export type Language = 'arduino' | 'micropython';
export type PinKind = 'digital' | 'pwm' | 'analog';

export interface PinMap {
  digital: number[];
  analog: string[]; // 'A0'…'A5'
  pwm: number[];
  i2c?: { sda: number | string; scl: number | string };
  spi?: { mosi: number; miso: number; sck: number; ss: number };
  serial?: { rx: number; tx: number }[];
  builtinLed?: number;
  /** Digital pins that can raise an external interrupt (encoders). Absent = every digital pin can. */
  interruptPins?: number[];
}

export interface OnboardPeripheral {
  id: string; // 'motorDriver', 'userButton', 'dip1'
  kind: 'dual-motor-driver' | 'button' | 'switch' | 'led' | 'buzzer';
  pins: Record<string, number>; // e.g. { AIN1: 7, AIN2: 8, PWMA: 5, … }
  /** false = placeholder mapping (IDE_DESIGN.md D3); generated code carries a #warning. */
  confirmed: boolean;
}

export interface BoardDefinition {
  id: string;
  name: string;
  vendor: string;
  family: BoardFamily;
  fqbn: string;
  usb: { vid: string; pid: string; label?: string }[];
  pins: PinMap;
  onboard?: OnboardPeripheral[];
  languages: Language[];
  defaultExtensions: string[];
  upload?: { speed?: number; protocol?: string };
  notes?: string[];
}

// ─────────────────────────── Extensions ───────────────────────────

export type ExtensionCategory =
  | 'core'
  | 'io'
  | 'sensors'
  | 'actuators'
  | 'displays'
  | 'robotics'
  | 'iot'
  | 'communication';

/**
 * A block type known to the IDE. Custom blocks carry Blockly JSON; `builtin` marks blocks whose
 * definition ships with Blockly itself (controls_if, math_number…) — we only provide emitters.
 */
export interface BlockSpec {
  type: string;
  json?: Record<string, unknown>;
  builtin?: boolean;
  boards?: string[] | '*';
  help?: string;
}

export type ToolboxItem =
  | {
      kind: 'block';
      type: string;
      inputs?: Record<string, unknown>;
      fields?: Record<string, unknown>;
      extraState?: unknown;
    }
  | { kind: 'sep'; gap?: number }
  | { kind: 'label'; text: string };

export interface ToolboxCategorySpec {
  id: string;
  name: string;
  /** Blockly theme category style name. */
  style: string;
  /** Dynamic Blockly category; `contents` is ignored when set. */
  custom?: 'VARIABLE' | 'PROCEDURE';
  contents: ToolboxItem[];
  boards?: string[] | '*';
}

export interface LibraryRequirement {
  name: string;
  version: string;
  families?: BoardFamily[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  category: ExtensionCategory;
  description: string;
  boards: string[] | '*';
  /** Arduino libraries the extension's blocks need; `families` limits one to some board families. */
  libraries?: LibraryRequirement[];
  /** Kits whose components this extension covers (shown in the extension library). */
  kits?: Array<'Starter' | 'Robotics' | 'IoT'>;
  blocks: BlockSpec[];
  toolbox: ToolboxCategorySpec[];
  emitters: Partial<Record<Language, Record<string, Emitter>>>;
  /** Live-mode handlers by block type (blocks without one cannot run live). */
  live?: Record<string, LiveHandler>;
}

// ───────────────────────── Code generation ─────────────────────────

export type SectionName =
  | 'includes'
  | 'globals'
  | 'functions'
  | 'setup.init'
  | 'setup.body'
  | 'loop.body';

/** What an emitter may contribute besides its inline code. Keys deduplicate. */
export interface Contribution {
  section: Exclude<SectionName, 'setup.body' | 'loop.body'>;
  key: string; // e.g. 'pinMode:13:OUTPUT', 'include:Servo.h'
  code: string;
  priority?: number; // ordering inside a section (lower first, default 100)
  /** Replace an existing entry with the same key (normally the first contribution wins). */
  override?: boolean;
}

export type ValueType = 'number' | 'boolean' | 'string';

export interface VariableInfo {
  identifier: string;
  type: ValueType;
}
export interface ProcedureInfo {
  name: string;
  identifier: string;
  params: VariableInfo[];
  returnType: ValueType | 'void';
}

export interface GeneratorOptions {
  serialBaud: number;
}

export interface EmitContext {
  readonly board: BoardDefinition;
  readonly options: GeneratorOptions;
  readonly blockId: string;
  readonly blockType: string;
  /** Code for a value input, parenthesised when its precedence is weaker than `order`. */
  value(inputName: string, order: number, fallback?: string): string;
  /** Static type of a connected value input (undefined when empty). */
  valueType(inputName: string): ValueType | undefined;
  hasInput(inputName: string): boolean;
  /** Code for a statement input, indented one level. Empty string when nothing is connected. */
  statements(inputName: string): string;
  field(name: string): string;
  extraState<T>(): T | undefined;
  contribute(c: Contribution): void;
  /** Variable referenced by a variable field (default field name 'VAR'). */
  variable(fieldName?: string): VariableInfo;
  procedure(name: string): ProcedureInfo | undefined;
  /** Fresh identifier for generated temporaries (loop counters…). */
  temp(base: string): string;
  /**
   * Inside a procedure body: the declaration line a language needs before the body can assign
   * program-wide variables (Python's indented `global a, b`). Empty when not needed.
   */
  scopeDeclarations(): string;
  /** Set while emitting the body of a procedure definition. */
  readonly currentProcedure: ProcedureInfo | undefined;
  /** `scope: 'program'` reports once for the whole program instead of on this block. */
  warn(message: string, scope?: 'block' | 'program'): void;
}

export type Emitter =
  /** Program entry point, e.g. "when board starts up". The generator lays out setup()/loop(). */
  | { kind: 'root'; bodyInput: string; loopBlockType: string; loopBodyInput: string }
  /** Top-level definition (function); contributes to sections, emits no inline code. */
  | { kind: 'definition'; emit(ctx: EmitContext): void }
  | { kind: 'statement'; emit(ctx: EmitContext): string }
  | {
      kind: 'value';
      type: ValueType | ((ctx: EmitContext) => ValueType);
      emit(ctx: EmitContext): [code: string, order: number];
    };

export interface GeneratedProgram {
  language: Language;
  code: string;
  /** 1-based line → block that produced it (first line of each statement). */
  sourceMap: Array<{ line: number; blockId: string }>;
  warnings: Array<{ blockId?: string; message: string }>;
  /** Extensions whose blocks the program uses. */
  extensions: string[];
  /** Arduino libraries the program needs on this board (pinned versions). */
  libraries: Array<{ name: string; version: string }>;
}
