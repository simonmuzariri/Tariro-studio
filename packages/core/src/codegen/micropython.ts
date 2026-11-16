/**
 * MicroPython generator for ESP32 boards (IDE_DESIGN.md v2). Same idea as the Arduino generator:
 * emitters return inline code and contribute keyed, deduplicated snippets — here `imports`
 * (section "includes"), module-level objects ("globals"), helper functions ("functions") and
 * start-up lines ("setup.init"). The program runs at module level: blocks before a trailing
 * `forever` run once, then its body becomes `while True:`.
 */
import type { BoardDefinition, Contribution, EmitContext, Emitter, GeneratedProgram, GeneratorOptions, ProcedureInfo, ValueType, VariableInfo } from '../types.js';
import type { ExtensionRegistry } from '../registry.js';
import { NameAllocator, wrap } from './cpp.js';
import { DEFAULT_OPTIONS } from './generator.js';
import { chain, fieldVariableId, inputBlock, isDisabled, type BlockJson, type WorkspaceJson } from './workspace.js';

/** Python operator precedence, tightest first. */
export const PY = {
  ATOMIC: 0,
  POSTFIX: 1, // f(x), a.b, a[i]
  POWER: 2,
  UNARY: 3,
  MULTIPLICATIVE: 4,
  ADDITIVE: 5,
  COMPARISON: 9,
  NOT: 10,
  AND: 11,
  OR: 12,
  CONDITIONAL: 13,
  NONE: 99,
} as const;

const PY_RESERVED = new Set(
  `False None True and as assert async await break class continue def del elif else except finally for from global if
  import in is lambda nonlocal not or pass raise return try while with yield print len str int float bool range min max
  abs round input open list dict set type id sum time machine math random network sys Pin PWM ADC`.split(/\s+/),
);

// Control characters are deliberate: invisible block-id markers that cannot occur in generated code.
// eslint-disable-next-line no-control-regex
const MARK = /\u0001([^\u0002]*)\u0002/g;
const INDENT = '    ';
const indent = (code: string) =>
  code
    .split('\n')
    .map((l) => (l.length ? INDENT + l : l))
    .join('\n');

type Section = Contribution['section'];

export function generateMicroPython(
  workspace: WorkspaceJson,
  board: BoardDefinition,
  registry: ExtensionRegistry,
  options: Partial<GeneratorOptions> = {},
): GeneratedProgram {
  return new MicroPythonGenerator(workspace, board, registry, { ...DEFAULT_OPTIONS, ...options }).run();
}

class MicroPythonGenerator {
  private readonly names = new NameAllocator();
  private readonly sections = new Map<Section, Map<string, { code: string; priority: number; seq: number }>>();
  private seq = 0;
  private readonly warnings: GeneratedProgram['warnings'] = [];
  private readonly warned = new Set<string>();
  private readonly variableNames = new Map<string, string>();
  private readonly globalsUsed = new Set<string>();
  private readonly usedTypes = new Set<string>();
  private readonly procedures = new Map<string, { info: ProcedureInfo; paramVarIds: string[]; block: BlockJson }>();
  private current: { info: ProcedureInfo; paramVarIds: string[]; globals: Set<string> } | undefined;
  private readonly tops: BlockJson[];

  constructor(
    workspace: WorkspaceJson,
    private readonly board: BoardDefinition,
    private readonly registry: ExtensionRegistry,
    private readonly options: GeneratorOptions,
  ) {
    this.tops = (workspace.blocks?.blocks ?? []).filter((b) => !isDisabled(b));
    for (const v of workspace.variables ?? []) this.variableNames.set(v.id, v.name);
    for (const w of PY_RESERVED) this.names.get(`reserved:${w}`, w); // keep learner names off built-ins
  }

  run(): GeneratedProgram {
    if (!this.board.languages.includes('micropython'))
      this.warn(undefined, `${this.board.name} cannot run MicroPython. Choose an ESP32 board.`);
    this.declareProcedures();

    const roots: BlockJson[] = [];
    for (const top of this.tops) {
      const e = this.emitter(top.type);
      if (e?.kind === 'root') roots.push(top);
      else if (e?.kind === 'definition') this.emitDefinition(top, e);
      else if (this.registry.emitter('arduino', top.type)?.kind === 'definition' || this.registry.emitter('arduino', top.type)?.kind === 'root')
        this.warn(top.id, 'This block is not available in MicroPython yet.');
      else this.warn(top.id, 'This block is not inside "when board starts up" or a function, so it is not part of the program.');
    }

    let setup = '';
    let loop: string | undefined;
    const [root, ...extra] = roots;
    for (const r of extra) this.warn(r.id, 'Only one "when board starts up" block is used. This one is ignored.');
    if (!root) this.warn(undefined, 'Add a "when board starts up" block to give your program a starting point.');
    else {
      const e = this.emitter(root.type) as Extract<Emitter, { kind: 'root' }>;
      const body = chain(inputBlock(root, e.bodyInput)).filter((b) => !isDisabled(b));
      const last = body.at(-1);
      if (last && last.type === e.loopBlockType) {
        setup = this.emitChain(body.slice(0, -1));
        const inner = this.emitChain(chain(inputBlock(last, e.loopBodyInput)));
        this.contribute({ section: 'includes', key: 'import:import time', code: 'import time' });
        // An empty or non-waiting loop must still let the board breathe (and keep Ctrl-C working).
        loop = `\u0001${last.id ?? ''}\u0002while True:\n${indent(inner || 'time.sleep_ms(10)')}`;
      } else setup = this.emitChain(body);
    }

    for (const id of this.globalsUsed) {
      if (!id) continue;
      this.contribute({ section: 'globals', key: `var:${id}`, code: `${this.variableInfo(id).identifier} = 0`, priority: 50 });
    }
    return this.assemble(setup, loop);
  }

  private emitter(type: string): Emitter | undefined {
    return this.registry.emitter('micropython', type);
  }

  private declareProcedures(): void {
    for (const top of this.tops) {
      if (top.type !== 'procedures_defnoreturn' && top.type !== 'procedures_defreturn') continue;
      const name = String(top.fields?.['NAME'] ?? 'function');
      if (this.procedures.has(name)) {
        this.warn(top.id, `Two functions are called "${name}". Only the first one is used.`);
        continue;
      }
      const params = (top.extraState as { params?: Array<{ name: string; id?: string }> } | undefined)?.params ?? [];
      const paramVarIds = params.map((p) => p.id ?? `param:${name}:${p.name}`);
      paramVarIds.forEach((id, i) => {
        if (!this.variableNames.has(id)) this.variableNames.set(id, params[i]!.name);
      });
      const info: ProcedureInfo = {
        name,
        identifier: this.names.get(`proc:${name}`, name),
        params: paramVarIds.map((id) => this.variableInfo(id)),
        returnType: top.type === 'procedures_defreturn' ? 'number' : 'void',
      };
      this.procedures.set(name, { info, paramVarIds, block: top });
    }
  }

  private variableInfo(id: string): VariableInfo {
    return { identifier: this.names.get(`var:${id}`, this.variableNames.get(id) ?? 'item'), type: 'number' };
  }

  private emitDefinition(block: BlockJson, e: Extract<Emitter, { kind: 'definition' }>): void {
    const decl = this.procedures.get(String(block.fields?.['NAME'] ?? ''));
    if (!decl || decl.block !== block) return;
    this.current = { info: decl.info, paramVarIds: decl.paramVarIds, globals: new Set() };
    try {
      this.usedTypes.add(block.type);
      e.emit(this.context(block));
    } finally {
      this.current = undefined;
    }
  }

  private emitChain(blocks: BlockJson[]): string {
    return blocks
      .filter((b) => !isDisabled(b))
      .map((b) => this.emitStatement(b))
      .filter((s) => s.length > 0)
      .join('\n');
  }

  private supported(b: BlockJson): Emitter | undefined {
    const e = this.emitter(b.type);
    if (!e) {
      this.warn(b.id, this.registry.emitter('arduino', b.type) ? 'This block is not available in MicroPython yet.' : `The block "${b.type}" is not known.`);
      return undefined;
    }
    if (!this.registry.blockSupported(b.type, this.board)) {
      this.warn(b.id, `This block does not work on ${this.board.name}.`);
      return undefined;
    }
    return e;
  }

  private emitStatement(b: BlockJson): string {
    const e = this.supported(b);
    const mark = b.id ? `\u0001${b.id}\u0002` : '';
    if (!e) return `${mark}pass  # (block not available: ${b.type})`;
    if (e.kind !== 'statement') {
      this.warn(b.id, 'This block cannot be used as a step on its own.');
      return '';
    }
    this.usedTypes.add(b.type);
    const code = e.emit(this.context(b));
    return code.length ? mark + code : '';
  }

  private emitValue(b: BlockJson | undefined, order: number, fallback: string): string {
    if (!b || isDisabled(b)) return fallback;
    const e = this.supported(b);
    if (!e || e.kind !== 'value') return fallback;
    this.usedTypes.add(b.type);
    const [code, inner] = e.emit(this.context(b));
    return wrap(code, inner, order);
  }

  private typeOf(b: BlockJson, input: string): ValueType | undefined {
    const child = inputBlock(b, input);
    const e = child && this.emitter(child.type);
    if (!child || e?.kind !== 'value') return undefined;
    return typeof e.type === 'string' ? e.type : e.type(this.context(child));
  }

  private context(b: BlockJson): EmitContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the context object outlives this call
    const g = this;
    const id = b.id ?? '';
    return {
      board: g.board,
      options: g.options,
      blockId: id,
      blockType: b.type,
      value: (name, order, fallback = '0') => g.emitValue(inputBlock(b, name), order, fallback),
      valueType: (name) => g.typeOf(b, name),
      hasInput: (name) => inputBlock(b, name) !== undefined,
      statements: (name) => indent(g.emitChain(chain(inputBlock(b, name))) || 'pass'),
      field: (name) => {
        const v = b.fields?.[name];
        if (v && typeof v === 'object' && 'id' in v) return g.variableNames.get(String((v as { id: unknown }).id)) ?? '';
        return v === undefined || v === null ? '' : String(v);
      },
      extraState: <T>() => b.extraState as T | undefined,
      contribute: (c) => g.contribute(c),
      variable: (fieldName = 'VAR') => {
        const varId = fieldVariableId(b, fieldName) ?? '';
        if (!g.current?.paramVarIds.includes(varId)) {
          g.globalsUsed.add(varId);
          g.current?.globals.add(varId);
        }
        return g.variableInfo(varId);
      },
      procedure: (name) => g.procedures.get(name)?.info,
      temp: (base) => g.names.fresh(base),
      scopeDeclarations: () => {
        const ids = [...(g.current?.globals ?? [])].filter(Boolean);
        return ids.length ? `${INDENT}global ${ids.map((v) => g.variableInfo(v).identifier).join(', ')}` : '';
      },
      get currentProcedure() {
        return g.current?.info;
      },
      warn: (message, scope = 'block') => g.warn(scope === 'program' ? undefined : id, message),
    };
  }

  private contribute(c: Contribution): void {
    let s = this.sections.get(c.section);
    if (!s) this.sections.set(c.section, (s = new Map()));
    const existing = s.get(c.key);
    if (!existing) s.set(c.key, { code: c.code, priority: c.priority ?? 100, seq: this.seq++ });
    else if (c.override) s.set(c.key, { ...existing, code: c.code });
  }

  private warn(blockId: string | undefined, message: string): void {
    const key = `${blockId ?? ''}|${message}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(blockId ? { blockId, message } : { message });
  }

  private section(name: Section): string[] {
    return [...(this.sections.get(name)?.values() ?? [])].sort((a, b) => a.priority - b.priority || a.seq - b.seq).map((e) => e.code);
  }

  private assemble(setup: string, loop: string | undefined): GeneratedProgram {
    const parts: string[] = [
      `# Generated by Tariro Studio for ${this.board.name} (MicroPython).`,
      '# Edit the blocks: changes made directly to this code are replaced when the blocks change.',
    ];
    const add = (items: string[], sep = '\n') => {
      if (items.length) parts.push('', items.join(sep));
    };
    add(mergeImports(this.section('includes')));
    add(this.section('globals'));
    add(this.section('functions'), '\n\n\n');
    add(this.section('setup.init'));
    if (setup) parts.push('', setup);
    if (loop) parts.push('', loop);
    parts.push('');

    const sourceMap: GeneratedProgram['sourceMap'] = [];
    const lines = parts.join('\n').split('\n').map((line, i) => {
      for (const m of line.matchAll(MARK)) if (m[1]) sourceMap.push({ line: i + 1, blockId: m[1] });
      return line.replace(MARK, '');
    });
    const extensions = [...new Set([...this.usedTypes].map((t) => this.registry.ownerOf(t)?.id).filter((x): x is string => !!x))].sort();
    return { language: 'micropython', code: lines.join('\n'), sourceMap, warnings: this.warnings, extensions, libraries: [] };
  }
}

/** One `import x` per module and one `from x import a, b` per package, sorted. */
function mergeImports(lines: string[]): string[] {
  const plain = new Set<string>();
  const from = new Map<string, Set<string>>();
  for (const line of lines) {
    const m = /^from (\S+) import (.+)$/.exec(line);
    if (!m) {
      plain.add(line);
      continue;
    }
    const names = from.get(m[1]!) ?? new Set<string>();
    for (const n of m[2]!.split(',')) names.add(n.trim());
    from.set(m[1]!, names);
  }
  return [...[...from].map(([mod, names]) => `from ${mod} import ${[...names].sort().join(', ')}`).sort(), ...[...plain].sort()];
}
