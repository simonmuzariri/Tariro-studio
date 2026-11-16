/** Tiny builder for Blockly workspace JSON, so example programs read like the block stacks they are. */
import type { BlockJson, WorkspaceJson } from '@tariro-studio/core';

let counter = 0;
const nextId = (type: string) => `${type}_${++counter}`;

export interface B {
  fields?: Record<string, unknown>;
  inputs?: Record<string, BlockJson>;
  /** Statement inputs: name → blocks to chain. */
  do?: Record<string, BlockJson[]>;
  extraState?: unknown;
  id?: string;
}

export function block(type: string, spec: B = {}): BlockJson {
  const out: BlockJson = { type, id: spec.id ?? nextId(type) };
  if (spec.fields) out.fields = spec.fields;
  if (spec.extraState !== undefined) out.extraState = spec.extraState;
  const inputs: NonNullable<BlockJson['inputs']> = {};
  for (const [name, child] of Object.entries(spec.inputs ?? {})) {
    // Literal number/text inputs are shadows, as the toolbox creates them.
    inputs[name] = child.type === 'math_number' || child.type === 'text' ? { shadow: child } : { block: child };
  }
  for (const [name, list] of Object.entries(spec.do ?? {})) {
    const head = stack(...list);
    if (head) inputs[name] = { block: head };
  }
  if (Object.keys(inputs).length) out.inputs = inputs;
  return out;
}

/** Chain statements through `next`, returning the first. */
export function stack(...blocks: BlockJson[]): BlockJson | undefined {
  for (let i = blocks.length - 2; i >= 0; i--) blocks[i]!.next = { block: blocks[i + 1]! };
  return blocks[0];
}

export const n = (v: number) => block('math_number', { fields: { NUM: v } });
export const t = (v: string) => block('text', { fields: { TEXT: v } });
export const v = (id: string) => block('variables_get', { fields: { VAR: { id } } });
export const set = (id: string, value: BlockJson) => block('variables_set', { fields: { VAR: { id } }, inputs: { VALUE: value } });
export const wait = (s: number) => block('tariro_wait_seconds', { inputs: { SECONDS: n(s) } });
export const program = (...body: BlockJson[]) => block('tariro_on_start', { id: 'start', do: { DO: body } });
export const forever = (...body: BlockJson[]) => block('tariro_forever', { id: 'loop', do: { DO: body } });

export function workspace(tops: BlockJson[], variables: Array<{ id: string; name: string }> = []): WorkspaceJson {
  tops.forEach((b, i) => {
    b.x = 40 + i * 400;
    b.y = 40;
  });
  return { blocks: { languageVersion: 0, blocks: tops }, ...(variables.length ? { variables } : {}) };
}
