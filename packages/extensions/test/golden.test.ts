import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly';
import { generateArduino, getBoard, type BoardDefinition, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, registerBlockly } from '../src/index.js';
import { EXAMPLES as GOLDEN_PROGRAMS } from '../src/examples.js';

const registry = createRegistry();
let currentBoard: BoardDefinition = getBoard('tariro');
registerBlockly(Blockly, registry, () => currentBoard);

/** Load into a real (headless) Blockly workspace and save again, as the IDE would. */
function roundTrip(ws: WorkspaceJson): WorkspaceJson {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(ws as Record<string, unknown>, workspace);
    return Blockly.serialization.workspaces.save(workspace) as WorkspaceJson;
  } finally {
    workspace.dispose();
  }
}

describe.each(GOLDEN_PROGRAMS)('golden program "$name"', (program) => {
  it.each(program.boards)('generates the expected sketch for %s', async (boardId) => {
    currentBoard = getBoard(boardId);
    const result = generateArduino(program.workspace, currentBoard, registry);
    await expect(result.code).toMatchFileSnapshot(`./golden/__snapshots__/${program.name}.${boardId}.ino`);
  });

  it('survives a Blockly load/save round trip unchanged', () => {
    const board = getBoard(program.boards[0]!);
    currentBoard = board;
    const direct = generateArduino(program.workspace, board, registry);
    const viaBlockly = generateArduino(roundTrip(program.workspace), board, registry);
    expect(viaBlockly.code).toBe(direct.code);
    expect(viaBlockly.warnings).toEqual(direct.warnings);
  });

  it('defines every block type it uses', () => {
    const types = new Set<string>();
    const visit = (b: { type: string; inputs?: Record<string, { block?: unknown; shadow?: unknown }>; next?: { block?: unknown } }): void => {
      types.add(b.type);
      for (const s of Object.values(b.inputs ?? {})) for (const c of [s.block, s.shadow]) if (c) visit(c as never);
      if (b.next?.block) visit(b.next.block as never);
    };
    program.workspace.blocks?.blocks?.forEach((b) => visit(b as never));
    for (const type of types) expect(Blockly.Blocks[type], type).toBeDefined();
  });
});
