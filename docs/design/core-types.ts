/**
 * Tariro Studio — core contracts (design draft v0.1, 2026-11-15).
 * Pure TypeScript, no DOM/Node imports. Becomes packages/core/src/types.ts in M0.
 * See IDE_DESIGN.md for rationale.
 */

// ───────────────────────────── Boards ─────────────────────────────

export type BoardFamily = 'avr' | 'esp32';
export type Language = 'arduino' | 'micropython';

export interface PinMap {
  digital: number[];
  analog: string[];            // 'A0'…'A5'
  pwm: number[];
  i2c?: { sda: number | string; scl: number | string };
  spi?: { mosi: number; miso: number; sck: number; ss: number };
  serial?: { rx: number; tx: number }[];
  builtinLed?: number;
  reserved?: number[];         // pins used by onboard peripherals (warn if reused)
}

export interface OnboardPeripheral {
  id: string;                  // 'motorDriver', 'userButton', 'dip1'
  kind: 'dual-motor-driver' | 'button' | 'switch' | 'led' | 'buzzer';
  pins: Record<string, number>; // e.g. { AIN1: 7, AIN2: 8, PWMA: 5, … }  (Tariro: NEEDS INPUT)
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
  image?: string;
}

// ─────────────────────────── Extensions ───────────────────────────

export type ExtensionCategory =
  | 'core' | 'sensors' | 'actuators' | 'displays' | 'robotics' | 'iot' | 'communication';

/** Blockly JSON block definition plus our metadata. */
export interface BlockSpec {
  type: string;                        // namespaced: '<extensionId>_<name>'
  json: Record<string, unknown>;       // Blockly.defineBlocksWithJsonArray entry
  boards?: string[] | '*';             // narrower than the extension, if needed
  help?: string;                       // offline help page id
}

export interface ToolboxCategorySpec {
  name: string;
  colour: string;
  icon?: string;
  contents: Array<{ kind: 'block'; type: string; inputs?: Record<string, unknown> } | { kind: 'sep' } | { kind: 'label'; text: string }>;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  category: ExtensionCategory;
  colour: string;
  icon: string;
  description: string;
  boards: string[] | '*';
  libraries?: { name: string; version: string }[];
  blocks: BlockSpec[];
  toolbox: ToolboxCategorySpec;
  emitters: Partial<Record<Language, Record<string, Emitter>>>;
}

// ───────────────────────── Code generation ─────────────────────────

export type SectionName = 'includes' | 'globals' | 'functions' | 'setup.init' | 'setup.body' | 'loop.body';

/** What an emitter may contribute besides its inline code. Keys deduplicate. */
export interface Contribution {
  section: Exclude<SectionName, 'setup.body' | 'loop.body'>;
  key: string;                 // e.g. 'pinMode:13:OUTPUT', 'include:Servo.h'
  code: string;
  priority?: number;           // ordering inside setup.init (lower first)
}

export interface EmitContext {
  board: BoardDefinition;
  /** Generate code for a value input; returns expression text. */
  value(inputName: string, fallback?: string): string;
  /** Generate code for a statement input; returns indented block text. */
  statements(inputName: string): string;
  field(name: string): string;
  contribute(c: Contribution): void;
  /** Unique C++ identifier for a user variable / list / function. */
  identifier(kind: 'var' | 'list' | 'func', name: string): string;
  warn(message: string): void;
  blockId: string;
}

export type Emitter =
  | { kind: 'statement'; emit(ctx: EmitContext): string }
  | { kind: 'value'; emit(ctx: EmitContext): [code: string, precedence: number] };

export interface GeneratedProgram {
  language: Language;
  code: string;
  sourceMap: Array<{ line: number; blockId: string }>;
  warnings: Array<{ blockId?: string; message: string }>;
}

// ──────────────────────────── Projects ────────────────────────────

export interface ProjectFileV1 {
  format: 'tariro-studio';
  formatVersion: 1;
  appVersion: string;
  id: string;
  name: string;
  board: string;
  extensions: string[];
  mode: 'blocks' | 'code';
  workspace?: unknown;         // Blockly.serialization.workspaces.save() output
  code?: string;
  serial: { baud: number };
  createdAt: string;           // ISO 8601
  modifiedAt: string;
}

// ───────────────────── IPC contract (preload API) ─────────────────────

export interface PortInfo { path: string; vid?: string; pid?: string; manufacturer?: string; serialNumber?: string; suggestedBoardId?: string }

export type BuildPhase = 'idle' | 'compiling' | 'uploading' | 'done' | 'error' | 'cancelled';
export interface CompilerDiagnostic { file: string; line: number; column?: number; severity: 'error' | 'warning'; message: string }
export interface BuildResult { ok: boolean; phase: BuildPhase; diagnostics: CompilerDiagnostic[]; sizes?: { flash: number; flashMax: number; ram: number; ramMax: number } }

export type Unsubscribe = () => void;

/** The only API exposed on window.studio. All arguments are validated in main with zod. */
export interface StudioApi {
  app: {
    version(): Promise<string>;
    openExternalHelp(topic: string): Promise<void>;
  };
  project: {
    openDialog(): Promise<{ path: string; project: ProjectFileV1; thumbnail?: Uint8Array } | null>;
    open(path: string): Promise<{ project: ProjectFileV1; thumbnail?: Uint8Array }>;
    save(path: string | null, project: ProjectFileV1, thumbnail: Uint8Array): Promise<string | null>; // null path → Save As dialog
    autosave(project: ProjectFileV1): Promise<void>;
    listRecoverable(): Promise<Array<{ id: string; name: string; modifiedAt: string }>>;
    recent(): Promise<Array<{ path: string; name: string; modifiedAt: string }>>;
    exportSketch(code: string, suggestedName: string): Promise<string | null>;
    listExamples(): Promise<Array<{ id: string; title: string; board: string; kit: string }>>;
    openExample(id: string): Promise<ProjectFileV1>;
  };
  toolchain: {
    compile(req: { code: string; fqbn: string; projectId: string }): Promise<BuildResult>;
    upload(req: { code: string; fqbn: string; port: string; projectId: string }): Promise<BuildResult>;
    cancel(): Promise<void>;
    onLog(cb: (line: string) => void): Unsubscribe;
    onProgress(cb: (p: { phase: BuildPhase; percent?: number }) => void): Unsubscribe;
  };
  serial: {
    listPorts(): Promise<PortInfo[]>;
    onPortsChanged(cb: (ports: PortInfo[]) => void): Unsubscribe;
    open(path: string, baud: number): Promise<void>;
    close(): Promise<void>;
    write(data: string): Promise<void>;
    onData(cb: (chunk: string) => void): Unsubscribe;
    onState(cb: (s: { open: boolean; path?: string; baud?: number; error?: string }) => void): Unsubscribe;
  };
  settings: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
}
