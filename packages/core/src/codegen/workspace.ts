/**
 * Minimal typing of Blockly's JSON serialization (`Blockly.serialization.workspaces.save`).
 * The generator works on this plain data, so it runs in Node tests without Blockly or a DOM, and
 * on exactly what a project file stores.
 */

export interface BlockJson {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  enabled?: boolean;
  disabledReasons?: string[];
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block?: BlockJson; shadow?: BlockJson };
  extraState?: unknown;
}

export interface VariableJson {
  name: string;
  id: string;
  type?: string;
}

export interface WorkspaceJson {
  blocks?: { languageVersion?: number; blocks?: BlockJson[] };
  variables?: VariableJson[];
}

export function isDisabled(b: BlockJson): boolean {
  return b.enabled === false || (b.disabledReasons?.length ?? 0) > 0;
}

/** The block plugged into an input (real block preferred over its shadow). */
export function inputBlock(b: BlockJson, name: string): BlockJson | undefined {
  const slot = b.inputs?.[name];
  return slot?.block ?? slot?.shadow;
}

export function nextBlock(b: BlockJson): BlockJson | undefined {
  return b.next?.block;
}

/** Walk every block (including shadows) depth-first. */
export function* walk(blocks: Iterable<BlockJson>): Generator<BlockJson> {
  for (const b of blocks) {
    yield b;
    for (const slot of Object.values(b.inputs ?? {})) {
      if (slot.block) yield* walk([slot.block]);
      else if (slot.shadow) yield* walk([slot.shadow]);
    }
    if (b.next?.block) yield* walk([b.next.block]);
  }
}

/** The statement chain starting at `first` (first, first.next, …). */
export function chain(first: BlockJson | undefined): BlockJson[] {
  const out: BlockJson[] = [];
  for (let b = first; b; b = nextBlock(b)) out.push(b);
  return out;
}

/** Variable reference stored in a field: Blockly saves `{ id }`. */
export function fieldVariableId(b: BlockJson, field: string): string | undefined {
  const v = b.fields?.[field];
  if (v && typeof v === 'object' && 'id' in v) return String((v as { id: unknown }).id);
  return undefined;
}
