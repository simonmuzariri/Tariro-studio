/**
 * Sectioned Arduino C++ generator (IDE_DESIGN.md §7).
 *
 * Emitters never build the whole sketch; they return inline code and *contribute* keyed snippets
 * to sections (includes, globals, functions, setup.init). Keys deduplicate, so ten "set pin 13"
 * blocks still produce one pinMode(13, OUTPUT). The program root ("when board starts up") lays
 * out setup()/loop(): statements before a trailing `forever` go to setup(), its body to loop().
 */
import type {
  BoardDefinition,
  Contribution,
  EmitContext,
  Emitter,
  GeneratedProgram,
  GeneratorOptions,
  ProcedureInfo,
  SectionName,
  ValueType,
  VariableInfo,
} from '../types.js';
import type { ExtensionRegistry } from '../registry.js';
import { cppType, defaultValue, indent, NameAllocator, ORDER, wrap } from './cpp.js';
import {
  chain,
  fieldVariableId,
  inputBlock,
  isDisabled,
  walk,
  type BlockJson,
  type WorkspaceJson,
} from './workspace.js';

const MARK_START = '\u0001';
const MARK_END = '\u0002';
// Control characters are deliberate: invisible block-id markers that cannot occur in generated C++.
// eslint-disable-next-line no-control-regex
const MARK_RE = /\u0001([^\u0002]*)\u0002/g;

export const DEFAULT_OPTIONS: GeneratorOptions = { serialBaud: 9600 };

type ContributionSection = Contribution['section'];
interface Entry {
  code: string;
  priority: number;
  seq: number;
}

interface ProcedureDecl {
  info: ProcedureInfo;
  paramVarIds: string[];
  block: BlockJson;
}

export function generateArduino(
  workspace: WorkspaceJson,
  board: BoardDefinition,
  registry: ExtensionRegistry,
  options: Partial<GeneratorOptions> = {},
): GeneratedProgram {
  return new ArduinoGenerator(workspace, board, registry, { ...DEFAULT_OPTIONS, ...options }).run();
}

class ArduinoGenerator {
  private readonly names = new NameAllocator();
  private readonly sections = new Map<ContributionSection, Map<string, Entry>>();
  private seq = 0;
  private readonly warnings: GeneratedProgram['warnings'] = [];
  private readonly warningKeys = new Set<string>();
  private readonly variableNames = new Map<string, string>(); // id → name
  private readonly variableTypes = new Map<string, ValueType>();
  private readonly globalsUsed = new Set<string>();
  private readonly usedTypes = new Set<string>();
  private readonly procedures = new Map<string, ProcedureDecl>(); // by procedure name
  private currentProcedure: ProcedureDecl | undefined;
  private readonly topBlocks: BlockJson[];

  constructor(
    private readonly workspace: WorkspaceJson,
    private readonly board: BoardDefinition,
    private readonly registry: ExtensionRegistry,
    private readonly options: GeneratorOptions,
  ) {
    this.topBlocks = (workspace.blocks?.blocks ?? []).filter((b) => !isDisabled(b));
    for (const v of workspace.variables ?? []) this.variableNames.set(v.id, v.name);
  }

  run(): GeneratedProgram {
    this.declareProcedures();
    this.inferTypes();

    const roots: BlockJson[] = [];
    for (const top of this.topBlocks) {
      const emitter = this.registry.emitter('arduino', top.type);
      if (emitter?.kind === 'root') roots.push(top);
      else if (emitter?.kind === 'definition') this.emitDefinition(top, emitter);
      else
        this.warn(
          top.id,
          'This block is not inside "when board starts up" or a function, so it is not part of the program.',
        );
    }

    let setupBody = '';
    let loopBody = '';
    const [root, ...extraRoots] = roots;
    for (const r of extraRoots)
      this.warn(r.id, 'Only one "when board starts up" block is used. This one is ignored.');
    if (!root) {
      this.warn(undefined, 'Add a "when board starts up" block to give your program a starting point.');
    } else {
      const rootEmitter = this.registry.emitter('arduino', root.type) as Extract<Emitter, { kind: 'root' }>;
      const body = chain(inputBlock(root, rootEmitter.bodyInput)).filter((b) => !isDisabled(b));
      const last = body.at(-1);
      if (last && last.type === rootEmitter.loopBlockType) {
        setupBody = this.emitChain(body.slice(0, -1));
        loopBody = this.emitChain(chain(inputBlock(last, rootEmitter.loopBodyInput)));
        this.mark(last.id); // the loop block itself maps to `void loop()`
      } else {
        setupBody = this.emitChain(body);
      }
    }

    this.declareGlobals();
    return this.assemble(setupBody, loopBody);
  }

  // ───────────────────────── pre-passes ─────────────────────────

  private declareProcedures(): void {
    for (const top of this.topBlocks) {
      if (top.type !== 'procedures_defnoreturn' && top.type !== 'procedures_defreturn') continue;
      const name = String(top.fields?.['NAME'] ?? 'function');
      if (this.procedures.has(name)) {
        this.warn(top.id, `Two functions are called "${name}". Only the first one is used.`);
        continue;
      }
      const params = (top.extraState as { params?: Array<{ name: string; id?: string }> } | undefined)?.params ?? [];
      const paramVarIds = params.map((p) => p.id ?? this.variableIdByName(p.name) ?? `param:${name}:${p.name}`);
      paramVarIds.forEach((id, i) => {
        if (!this.variableNames.has(id)) this.variableNames.set(id, params[i]!.name);
      });
      const info: ProcedureInfo = {
        name,
        identifier: this.names.get(`proc:${name}`, name),
        params: [],
        returnType: top.type === 'procedures_defreturn' ? 'number' : 'void',
      };
      this.procedures.set(name, { info, paramVarIds, block: top });
    }
  }

  private variableIdByName(name: string): string | undefined {
    for (const [id, n] of this.variableNames) if (n === name) return id;
    return undefined;
  }

  private inferring = false;

  /** Fixed-point type inference over variable assignments, call arguments and returns. */
  private inferTypes(): void {
    this.inferring = true;
    try {
      this.inferTypesPass();
    } finally {
      this.inferring = false;
    }
  }

  private inferTypesPass(): void {
    const all = [...walk(this.topBlocks)];
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      const assign = (id: string | undefined, t: ValueType | undefined, blockId?: string) => {
        if (!id || !t) return;
        const prev = this.variableTypes.get(id);
        if (prev === undefined || (prev === 'number' && t !== 'number')) {
          if (prev !== t) {
            this.variableTypes.set(id, t);
            changed = true;
          }
        } else if (prev !== t && pass === 3) {
          this.warn(blockId, `"${this.variableNames.get(id) ?? id}" is used both as ${prev} and as ${t}.`);
        }
      };
      for (const b of all) {
        if (b.type === 'variables_set') assign(fieldVariableId(b, 'VAR'), this.typeOfInput(b, 'VALUE'), b.id);
        else if (b.type === 'math_change' || b.type === 'controls_for')
          assign(fieldVariableId(b, 'VAR'), 'number', b.id);
        else if (b.type === 'procedures_callreturn' || b.type === 'procedures_callnoreturn') {
          const decl = this.procedures.get(String((b.extraState as { name?: string } | undefined)?.name ?? ''));
          decl?.paramVarIds.forEach((id, i) => assign(id, this.typeOfInput(b, `ARG${i}`), b.id));
        }
      }
      for (const decl of this.procedures.values()) {
        if (decl.block.type === 'procedures_defreturn') {
          const t = this.typeOfInput(decl.block, 'RETURN') ?? 'number';
          if (decl.info.returnType !== t) {
            decl.info.returnType = t;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    for (const decl of this.procedures.values()) {
      decl.info.params = decl.paramVarIds.map((id) => this.variableInfo(id));
    }
  }

  private typeOfInput(b: BlockJson, input: string): ValueType | undefined {
    const child = inputBlock(b, input);
    if (!child) return undefined;
    const emitter = this.registry.emitter('arduino', child.type);
    if (emitter?.kind !== 'value') return undefined;
    return typeof emitter.type === 'string' ? emitter.type : emitter.type(this.context(child));
  }

  private variableInfo(id: string): VariableInfo {
    return {
      identifier: this.names.get(`var:${id}`, this.variableNames.get(id) ?? 'item'),
      type: this.variableTypes.get(id) ?? 'number',
    };
  }

  // ───────────────────────── emission ─────────────────────────

  private emitDefinition(block: BlockJson, emitter: Extract<Emitter, { kind: 'definition' }>): void {
    const name = String(block.fields?.['NAME'] ?? '');
    const decl = this.procedures.get(name);
    if (decl && decl.block !== block) return; // duplicate name, already warned
    this.currentProcedure = decl;
    try {
      this.usedTypes.add(block.type);
      emitter.emit(this.context(block));
    } finally {
      this.currentProcedure = undefined;
    }
  }

  private emitChain(blocks: BlockJson[]): string {
    return blocks
      .filter((b) => !isDisabled(b))
      .map((b) => this.emitStatement(b))
      .filter((s) => s.length > 0)
      .join('\n');
  }

  private emitStatement(b: BlockJson): string {
    const emitter = this.registry.emitter('arduino', b.type);
    if (!emitter) {
      this.warn(b.id, `The block "${b.type}" cannot be turned into Arduino code yet.`);
      return `${this.markerFor(b.id)}// (unsupported block: ${b.type})`;
    }
    if (!this.registry.blockSupported(b.type, this.board)) {
      this.warn(b.id, `This block does not work on ${this.board.name}.`);
      return `${this.markerFor(b.id)}// (block not available on ${this.board.name}: ${b.type})`;
    }
    if (emitter.kind !== 'statement') {
      this.warn(b.id, 'This block cannot be used as a step on its own.');
      return '';
    }
    this.usedTypes.add(b.type);
    const code = emitter.emit(this.context(b));
    return code.length ? this.markerFor(b.id) + code : '';
  }

  private emitValue(b: BlockJson | undefined, order: number, fallback: string): string {
    if (!b || isDisabled(b)) return fallback;
    const emitter = this.registry.emitter('arduino', b.type);
    if (!emitter || emitter.kind !== 'value') {
      this.warn(b.id, `The block "${b.type}" cannot be turned into Arduino code yet.`);
      return fallback;
    }
    if (!this.registry.blockSupported(b.type, this.board)) {
      this.warn(b.id, `This block does not work on ${this.board.name}.`);
      return fallback;
    }
    this.usedTypes.add(b.type);
    const [code, inner] = emitter.emit(this.context(b));
    return wrap(code, inner, order);
  }

  private markerFor(id: string | undefined): string {
    return id ? `${MARK_START}${id}${MARK_END}` : '';
  }

  private pendingMarks: string[] = [];
  private mark(id: string | undefined): void {
    if (id) this.pendingMarks.push(id);
  }

  private context(b: BlockJson): EmitContext {
    // The returned object outlives this call and needs a getter, so it closes over the generator.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const g = this;
    const id = b.id ?? '';
    return {
      board: g.board,
      options: g.options,
      blockId: id,
      blockType: b.type,
      value: (name, order, fallback = '0') => g.emitValue(inputBlock(b, name), order, fallback),
      valueType: (name) => g.typeOfInput(b, name),
      hasInput: (name) => inputBlock(b, name) !== undefined,
      statements: (name) => {
        const code = g.emitChain(chain(inputBlock(b, name)));
        return code ? indent(code) : '';
      },
      field: (name) => {
        const v = b.fields?.[name];
        if (v && typeof v === 'object' && 'id' in v) return g.variableNames.get(String((v as { id: unknown }).id)) ?? '';
        return v === undefined || v === null ? '' : String(v);
      },
      extraState: <T>() => b.extraState as T | undefined,
      contribute: (c) => g.contribute(c),
      variable: (fieldName = 'VAR') => {
        const varId = fieldVariableId(b, fieldName) ?? '';
        const isParam = g.currentProcedure?.paramVarIds.includes(varId) ?? false;
        if (!isParam && !g.inferring) g.globalsUsed.add(varId);
        return g.variableInfo(varId);
      },
      procedure: (name) => g.procedures.get(name)?.info,
      temp: (base) => g.names.fresh(base),
      scopeDeclarations: () => '',
      get currentProcedure() {
        return g.currentProcedure?.info;
      },
      warn: (message, scope = 'block') => {
        if (!g.inferring) g.warn(scope === 'program' ? undefined : id, message);
      },
    };
  }

  private contribute(c: Contribution): void {
    let section = this.sections.get(c.section);
    if (!section) this.sections.set(c.section, (section = new Map()));
    const existing = section.get(c.key);
    if (!existing) section.set(c.key, { code: c.code, priority: c.priority ?? 100, seq: this.seq++ });
    else if (c.override) section.set(c.key, { ...existing, code: c.code });
  }

  private declareGlobals(): void {
    for (const id of this.globalsUsed) {
      if (!id) continue;
      const v = this.variableInfo(id);
      this.contribute({
        section: 'globals',
        key: `var:${id}`,
        code: `${cppType(v.type)} ${v.identifier} = ${defaultValue(v.type)};`,
        priority: 50,
      });
    }
  }

  private warn(blockId: string | undefined, message: string): void {
    const key = `${blockId ?? ''}|${message}`;
    if (this.warningKeys.has(key)) return;
    this.warningKeys.add(key);
    this.warnings.push(blockId ? { blockId, message } : { message });
  }

  // ───────────────────────── assembly ─────────────────────────

  private section(name: ContributionSection): string[] {
    return [...(this.sections.get(name)?.values() ?? [])]
      .sort((a, b) => a.priority - b.priority || a.seq - b.seq)
      .map((e) => e.code);
  }

  private assemble(setupBody: string, loopBody: string): GeneratedProgram {
    const parts: string[] = [
      '/*',
      ` * Generated by Tariro Studio for ${this.board.name}.`,
      ' * Edit the blocks: changes made directly to this code are replaced when the blocks change.',
      ' */',
    ];
    const blockOf = (name: ContributionSection) => {
      const items = this.section(name);
      if (items.length) parts.push('', items.join('\n'));
    };
    blockOf('includes');
    blockOf('globals');
    const functions = this.section('functions');
    if (functions.length) parts.push('', functions.join('\n\n'));

    const setupInit = this.section('setup.init').join('\n');
    const setupLines = [setupInit, setupBody].filter((s) => s.length > 0).join('\n\n');
    parts.push('', 'void setup() {', setupLines ? indent(setupLines) : '', '}');
    const loopMark = this.pendingMarks.map((m) => this.markerFor(m)).join('');
    parts.push('', `${loopMark}void loop() {`, loopBody ? indent(loopBody) : '', '}', '');

    const lines = parts.join('\n').replace(/\n{3,}/g, '\n\n').split('\n');
    const sourceMap: GeneratedProgram['sourceMap'] = [];
    const clean = lines.map((line, i) => {
      for (const m of line.matchAll(MARK_RE)) sourceMap.push({ line: i + 1, blockId: m[1]! });
      return line.replace(MARK_RE, '');
    });
    // Remove empty lines left inside empty setup()/loop() bodies.
    const code = clean.join('\n').replace(/\{\n\n\}/g, '{\n}');
    const extensions = [...new Set([...this.usedTypes].map((t) => this.registry.ownerOf(t)?.id).filter((x): x is string => !!x))].sort();
    return {
      language: 'arduino',
      code,
      sourceMap: this.remapAfterCollapse(clean, sourceMap),
      warnings: this.warnings,
      extensions,
      libraries: this.registry.librariesFor(this.usedTypes, this.board),
    };
  }

  /** Line numbers shift when empty bodies collapse; recompute against the final text. */
  private remapAfterCollapse(clean: string[], map: GeneratedProgram['sourceMap']): GeneratedProgram['sourceMap'] {
    const removed: number[] = [];
    for (let i = 1; i < clean.length - 1; i++) {
      if (clean[i] === '' && clean[i - 1]!.endsWith('{') && clean[i + 1] === '}') removed.push(i + 1);
    }
    return map.map(({ line, blockId }) => ({ line: line - removed.filter((r) => r < line).length, blockId }));
  }
}

export type { SectionName };
export { ORDER };
