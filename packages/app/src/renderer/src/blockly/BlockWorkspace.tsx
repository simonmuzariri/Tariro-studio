import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as Blockly from 'blockly';
import type { BoardDefinition, GeneratedProgram, WorkspaceJson } from '@tariro-studio/core';
import { buildToolbox, registerBlockly } from '@tariro-studio/extensions';
import { registry } from '../registry';
import { tariroTheme } from './theme';

// The pin dropdowns read the board at the moment they open.
let currentBoard: BoardDefinition | undefined;
registerBlockly(Blockly, registry, () => {
  if (!currentBoard) throw new Error('Board not set');
  return currentBoard;
});

export interface BlockWorkspaceHandle {
  /** Select and scroll to a block (from a warning or a code line). */
  focusBlock(id: string): void;
  /** Mark blocks that produced warnings. */
  showWarnings(warnings: GeneratedProgram['warnings']): void;
  /** Glow the block that live mode is running (null clears it). */
  highlight(id: string | null): void;
}

interface Props {
  board: BoardDefinition;
  /** Extensions the project has turned on (beyond the board's built-ins). */
  extensions: string[];
  initial: WorkspaceJson;
  /** `load`: Blockly re-serialised what it was given (mount, board switch). `edit`: the learner changed something. */
  onChange(workspace: WorkspaceJson, origin: 'load' | 'edit'): void;
  onSelect(blockId: string | null): void;
}

export const BlockWorkspace = forwardRef<BlockWorkspaceHandle, Props>(function BlockWorkspace(
  { board, extensions, initial, onChange, onSelect },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const callbacks = useRef({ onChange, onSelect });
  callbacks.current = { onChange, onSelect };
  currentBoard = board;

  // Create the workspace once.
  useEffect(() => {
    if (!host.current) return;
    const workspace = Blockly.inject(host.current, {
      toolbox: buildToolbox(registry.toolboxFor(board, extensions)),
      theme: tariroTheme,
      renderer: 'zelos',
      media: './',
      sounds: true,
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.8, maxScale: 2, minScale: 0.4, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: '#dde2ea', snap: false },
    });
    ws.current = workspace;
    Blockly.serialization.workspaces.load(initial as Record<string, unknown>, workspace);
    workspace.addChangeListener(Blockly.Events.disableOrphans);

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Blockly delivers events asynchronously; a disposed workspace must never report changes.
    let alive = true;
    const save = () => Blockly.serialization.workspaces.save(workspace) as WorkspaceJson;
    workspace.addChangeListener((e: Blockly.Events.Abstract) => {
      if (!alive) return;
      if (e.type === Blockly.Events.SELECTED) {
        callbacks.current.onSelect((e as Blockly.Events.Selected).newElementId ?? null);
        return;
      }
      if (e.isUiEvent || workspace.isDragging()) return;
      clearTimeout(timer);
      timer = setTimeout(() => alive && callbacks.current.onChange(save(), 'edit'), 120);
    });
    callbacks.current.onChange(save(), 'load');

    const resize = new ResizeObserver(() => Blockly.svgResize(workspace));
    resize.observe(host.current);
    return () => {
      alive = false;
      clearTimeout(timer);
      resize.disconnect();
      workspace.dispose();
      ws.current = null;
    };
    // `initial` and `board` are only read on first mount; later board changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Board change: new toolbox, and regenerate (pins/blocks may now be invalid).
  useEffect(() => {
    const workspace = ws.current;
    if (!workspace) return;
    workspace.updateToolbox(buildToolbox(registry.toolboxFor(board, extensions)));
    workspace.refreshToolboxSelection();
    callbacks.current.onChange(Blockly.serialization.workspaces.save(workspace) as WorkspaceJson, 'load');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extensions are handled by the effect below
  }, [board]);

  // Extensions added or removed: only the toolbox changes.
  const extensionKey = extensions.join(',');
  useEffect(() => {
    const workspace = ws.current;
    if (!workspace) return;
    workspace.updateToolbox(buildToolbox(registry.toolboxFor(board, extensionKey ? extensionKey.split(',') : [])));
    workspace.refreshToolboxSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- board changes are handled above
  }, [extensionKey]);

  useImperativeHandle(ref, () => ({
    focusBlock(id) {
      const block = ws.current?.getBlockById(id);
      if (!block) return;
      ws.current!.centerOnBlock(id);
      block.select();
    },
    highlight(id) {
      ws.current?.highlightBlock(id);
    },
    showWarnings(warnings) {
      const workspace = ws.current;
      if (!workspace) return;
      const byBlock = new Map<string, string[]>();
      for (const w of warnings) if (w.blockId) byBlock.set(w.blockId, [...(byBlock.get(w.blockId) ?? []), w.message]);
      for (const block of workspace.getAllBlocks(false)) {
        const msgs = byBlock.get(block.id);
        block.setWarningText(msgs ? msgs.join('\n') : null);
      }
    },
  }));

  return <div ref={host} className="blockly-host" data-testid="block-workspace" />;
});
