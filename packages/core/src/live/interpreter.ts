/**
 * Live mode: run the block program on the PC, one block at a time, driving the board through a
 * `LiveBoard` (Firmata). Works on the same Blockly JSON as the code generators. Each block type
 * has a `LiveHandler` supplied by its extension; blocks without one cannot run live.
 */
import type { BoardDefinition } from '../types.js';
import type { ExtensionRegistry } from '../registry.js';
import { chain, fieldVariableId, inputBlock, isDisabled, walk, type BlockJson, type WorkspaceJson } from '../codegen/workspace.js';
import type { LiveBoard } from './firmata.js';

export type LiveValue = number | boolean | string;

export const toNumber = (v: LiveValue): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : 0;
};
export const toBoolean = (v: LiveValue): boolean => (typeof v === 'string' ? v.length > 0 : typeof v === 'number' ? v !== 0 : v);
/** Text as the board would print it: true/false print as 1/0, like Arduino. */
export const toText = (v: LiveValue): string => (typeof v === 'boolean' ? (v ? '1' : '0') : typeof v === 'number' ? String(Number.isInteger(v) ? v : Math.round(v * 100) / 100) : v);

export interface LiveHost {
  io: LiveBoard;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Output of "serial print" blocks. */
  print(text: string): void;
  /** The statement block that is running (undefined when the program ends). */
  onBlock?(blockId: string | undefined): void;
}

export interface LiveContext {
  readonly board: BoardDefinition;
  readonly io: LiveBoard;
  readonly blockId: string;
  value(input: string, fallback: LiveValue): Promise<LiveValue>;
  number(input: string, fallback?: number): Promise<number>;
  text(input: string, fallback?: string): Promise<string>;
  truthy(input: string, fallback?: boolean): Promise<boolean>;
  hasInput(input: string): boolean;
  /** Run a statement input once. */
  statements(input: string): Promise<void>;
  /** Run a loop body once. False when the body asked to break out of the loop. */
  iterate(input: string): Promise<boolean>;
  field(name: string): string;
  extraState<T>(): T | undefined;
  getVariable(field?: string): LiveValue;
  setVariable(value: LiveValue, field?: string): void;
  /** Digital pin number from a pin field ("7", or "A0" resolved for this board). */
  pin(field?: string): Promise<number>;
  /** Pause the program; ends early when the learner presses Stop. */
  wait(ms: number): Promise<void>;
  /** Milliseconds since the program started. */
  millis(): number;
  print(text: string): void;
  call(name: string, args: LiveValue[]): Promise<LiveValue>;
  readonly inProcedure: boolean;
  /** Leave the loop (`BREAK`) or start its next round (`CONTINUE`). */
  flow(kind: 'BREAK' | 'CONTINUE'): never;
  /** Leave the current function. */
  returnValue(value?: LiveValue): never;
  fail(message: string): never;
}

export type LiveHandler =
  | { kind: 'statement'; run(ctx: LiveContext): Promise<void> }
  | { kind: 'value'; run(ctx: LiveContext): Promise<LiveValue> };

export interface LiveProblem {
  blockId?: string;
  message: string;
}

export interface LiveResult {
  outcome: 'finished' | 'stopped' | 'error';
  message: string;
  blockId?: string;
}

class Stop {}
class Flow {
  constructor(readonly kind: 'BREAK' | 'CONTINUE') {}
}
class Return {
  constructor(readonly value: LiveValue | undefined) {}
}
class LiveError extends Error {
  constructor(
    message: string,
    readonly blockId: string | undefined,
  ) {
    super(message);
  }
}

const PROCEDURE_DEFS = new Set(['procedures_defnoreturn', 'procedures_defreturn']);
const MAX_DEPTH = 100;

const rootInput = (registry: ExtensionRegistry, type: string): string | undefined => {
  const e = registry.emitter('arduino', type);
  return e?.kind === 'root' ? e.bodyInput : undefined;
};

/** Why this program cannot run live on this board (empty = it can). */
export function checkLive(workspace: WorkspaceJson, board: BoardDefinition, registry: ExtensionRegistry): LiveProblem[] {
  const problems: LiveProblem[] = [];
  if (board.family !== 'avr') return [{ message: `Live mode is not available for ${board.name} yet. Use Upload instead.` }];
  const tops = (workspace.blocks?.blocks ?? []).filter((b) => !isDisabled(b));
  const used = tops.filter((b) => rootInput(registry, b.type) !== undefined || PROCEDURE_DEFS.has(b.type));
  if (!tops.some((b) => rootInput(registry, b.type) !== undefined))
    problems.push({ message: 'Add a "when board starts up" block to give your program a starting point.' });
  for (const b of walk(used)) {
    if (isDisabled(b) || rootInput(registry, b.type) !== undefined || PROCEDURE_DEFS.has(b.type)) continue;
    if (!registry.liveHandler(b.type)) problems.push({ ...(b.id ? { blockId: b.id } : {}), message: 'This block cannot run in live mode. Use Upload for this program.' });
    else if (!registry.blockSupported(b.type, board)) problems.push({ ...(b.id ? { blockId: b.id } : {}), message: `This block is not available on ${board.name}.` });
  }
  return problems;
}

interface Procedure {
  block: BlockJson;
  paramIds: string[];
  returns: boolean;
}

/** One run of a program. Create, `run()`, and `stop()` to end it early. */
export class LiveRun {
  private stopped = false;
  private readonly globals = new Map<string, LiveValue>();
  private readonly frames: Array<Map<string, LiveValue>> = [];
  private readonly procedures = new Map<string, Procedure>();
  private readonly variableIds = new Map<string, string>(); // name → id
  private startedAt = 0;
  private steps = 0;

  constructor(
    private readonly workspace: WorkspaceJson,
    private readonly board: BoardDefinition,
    private readonly registry: ExtensionRegistry,
    private readonly host: LiveHost,
  ) {
    for (const v of workspace.variables ?? []) this.variableIds.set(v.name, v.id);
  }

  stop(): void {
    this.stopped = true;
  }

  async run(): Promise<LiveResult> {
    const problems = checkLive(this.workspace, this.board, this.registry);
    if (problems.length) return { outcome: 'error', message: problems[0]!.message, ...(problems[0]!.blockId ? { blockId: problems[0]!.blockId } : {}) };
    const tops = (this.workspace.blocks?.blocks ?? []).filter((b) => !isDisabled(b));
    for (const b of tops) {
      if (!PROCEDURE_DEFS.has(b.type)) continue;
      const name = String(b.fields?.['NAME'] ?? '');
      if (this.procedures.has(name)) continue;
      const params = (b.extraState as { params?: Array<{ name: string; id?: string }> } | undefined)?.params ?? [];
      this.procedures.set(name, {
        block: b,
        paramIds: params.map((p) => p.id ?? this.variableIds.get(p.name) ?? `param:${name}:${p.name}`),
        returns: b.type === 'procedures_defreturn',
      });
    }
    const root = tops.find((b) => rootInput(this.registry, b.type) !== undefined)!;
    this.startedAt = this.host.now();
    try {
      await this.runChain(inputBlock(root, rootInput(this.registry, root.type)!));
      return { outcome: 'finished', message: 'The program finished.' };
    } catch (e) {
      if (e instanceof Stop) return { outcome: 'stopped', message: 'Stopped.' };
      if (e instanceof LiveError) return { outcome: 'error', message: e.message, ...(e.blockId ? { blockId: e.blockId } : {}) };
      if (e instanceof Flow) return { outcome: 'error', message: '"break out of loop" was used outside a loop.' };
      if (e instanceof Return) return { outcome: 'finished', message: 'The program finished.' };
      return { outcome: 'error', message: e instanceof Error ? e.message : String(e) };
    } finally {
      this.host.onBlock?.(undefined);
    }
  }

  private async runChain(first: BlockJson | undefined): Promise<void> {
    for (const b of chain(first)) {
      if (isDisabled(b)) continue;
      if (this.stopped) throw new Stop();
      // Let the UI and the serial port breathe so a tight loop cannot freeze the app.
      if (++this.steps % 50 === 0) await this.host.sleep(0);
      const handler = this.registry.liveHandler(b.type);
      if (handler?.kind !== 'statement') throw new LiveError('This block cannot run in live mode.', b.id);
      this.host.onBlock?.(b.id);
      await this.guard(b, () => handler.run(this.context(b)));
    }
  }

  private async evaluate(b: BlockJson): Promise<LiveValue> {
    const handler = this.registry.liveHandler(b.type);
    if (handler?.kind !== 'value') throw new LiveError('This block cannot run in live mode.', b.id);
    return this.guard(b, () => handler.run(this.context(b)));
  }

  /** Attach the failing block to errors raised by handlers or the board. */
  private async guard<T>(b: BlockJson, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof Stop || e instanceof Flow || e instanceof Return || e instanceof LiveError) throw e;
      throw new LiveError(e instanceof Error ? e.message : String(e), b.id);
    }
  }

  private variableId(b: BlockJson, field: string): string {
    return fieldVariableId(b, field) ?? `field:${String(b.fields?.[field] ?? field)}`;
  }

  private async callProcedure(name: string, args: LiveValue[], caller: BlockJson): Promise<LiveValue> {
    const proc = this.procedures.get(name);
    if (!proc) throw new LiveError(`There is no function called "${name}".`, caller.id);
    if (this.frames.length >= MAX_DEPTH) throw new LiveError(`The function "${name}" calls itself too many times.`, caller.id);
    const frame = new Map<string, LiveValue>();
    proc.paramIds.forEach((id, i) => frame.set(id, args[i] ?? 0));
    this.frames.push(frame);
    try {
      await this.runChain(inputBlock(proc.block, 'STACK'));
      if (!proc.returns) return 0;
      const ret = inputBlock(proc.block, 'RETURN');
      return ret ? await this.evaluate(ret) : 0;
    } catch (e) {
      if (e instanceof Return) return e.value ?? 0;
      throw e;
    } finally {
      this.frames.pop();
    }
  }

  private context(b: BlockJson): LiveContext {
    const value = async (input: string, fallback: LiveValue): Promise<LiveValue> => {
      const child = inputBlock(b, input);
      return child && !isDisabled(child) ? this.evaluate(child) : fallback;
    };
    const scope = (id: string) => {
      const frame = this.frames.at(-1);
      return frame?.has(id) ? frame : this.globals;
    };
    return {
      board: this.board,
      io: this.host.io,
      blockId: b.id ?? '',
      value,
      number: async (input, fallback = 0) => toNumber(await value(input, fallback)),
      text: async (input, fallback = '') => toText(await value(input, fallback)),
      truthy: async (input, fallback = false) => toBoolean(await value(input, fallback)),
      hasInput: (input) => inputBlock(b, input) !== undefined,
      statements: (input) => this.runChain(inputBlock(b, input)),
      iterate: async (input) => {
        if (this.stopped) throw new Stop();
        await this.host.sleep(0); // every loop round yields, so Stop always gets through
        try {
          await this.runChain(inputBlock(b, input));
        } catch (e) {
          if (e instanceof Flow) return e.kind === 'CONTINUE';
          throw e;
        }
        return true;
      },
      field: (name) => String(b.fields?.[name] ?? ''),
      extraState: <T>() => b.extraState as T | undefined,
      getVariable: (field = 'VAR') => {
        const id = this.variableId(b, field);
        return scope(id).get(id) ?? 0;
      },
      setVariable: (v, field = 'VAR') => {
        const id = this.variableId(b, field);
        scope(id).set(id, v);
      },
      pin: async (field = 'PIN') => {
        const raw = String(b.fields?.[field] ?? '');
        const analog = /^A(\d+)$/.exec(raw);
        const n = analog ? await this.host.io.analogPin(Number(analog[1])) : Number(raw);
        if (n === undefined || !Number.isInteger(n) || n < 0) throw new LiveError(`Pin ${raw} is not a pin on this board.`, b.id);
        return n;
      },
      wait: async (ms) => {
        const end = this.host.now() + Math.max(0, ms);
        for (;;) {
          if (this.stopped) throw new Stop();
          const left = end - this.host.now();
          if (left <= 0) return;
          await this.host.sleep(Math.min(left, 50));
        }
      },
      millis: () => this.host.now() - this.startedAt,
      print: (text) => this.host.print(text),
      call: (name, args) => this.callProcedure(name, args, b),
      inProcedure: this.frames.length > 0,
      flow: (kind) => {
        throw new Flow(kind);
      },
      returnValue: (v) => {
        throw new Return(v);
      },
      fail: (message) => {
        throw new LiveError(message, b.id);
      },
    };
  }
}
