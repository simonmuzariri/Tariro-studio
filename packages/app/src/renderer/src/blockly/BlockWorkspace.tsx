import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as Blockly from 'blockly';
import { LocateFixed, PanelLeftClose, PanelLeftOpen, Redo2, Search, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { BoardDefinition, GeneratedProgram, WorkspaceJson } from '@tariro-studio/core';
import { buildToolbox, registerBlockly } from '@tariro-studio/extensions';
import { registry } from '../registry';
import { categoryIcon } from '../ui/categories';
import type { ThemeName } from '../ui/theme';
import { blocklyTheme } from './theme';

// The pin dropdowns read the board at the moment they open.
let currentBoard: BoardDefinition | undefined;
registerBlockly(Blockly, registry, () => {
  if (!currentBoard) throw new Error('Board not set');
  return currentBoard;
});

/**
 * Blockly's own category row, with our look: an icon tile in the category colour instead of a
 * colour stripe. Selection and hover are styled in styles.css. Everything else (flyout, keyboard
 * navigation, dynamic categories) is Blockly's.
 */
class TariroCategory extends Blockly.ToolboxCategory {
  private iconRoot: Root | undefined;

  protected override createIconDom_(): Element {
    const el = document.createElement('span');
    el.className = 'tcat-icon';
    const Icon = categoryIcon(this.getId());
    this.iconRoot = createRoot(el);
    this.iconRoot.render(<Icon aria-hidden="true" />);
    return el;
  }

  protected override addColourBorder_(colour: string): void {
    this.rowDiv_?.style.setProperty('--cat', colour);
  }

  override setSelected(isSelected: boolean): void {
    super.setSelected(isSelected);
    // The selected look comes from the stylesheet (a tint of the category colour), not an inline fill.
    if (this.rowDiv_) this.rowDiv_.style.backgroundColor = '';
  }

  override dispose(): void {
    const root = this.iconRoot;
    this.iconRoot = undefined;
    if (root) queueMicrotask(() => root.unmount());
    super.dispose();
  }
}
Blockly.registry.register(Blockly.registry.Type.TOOLBOX_ITEM, Blockly.ToolboxCategory.registrationName, TariroCategory, true);

export interface BlockWorkspaceHandle {
  /** Select and scroll to a block (from a warning or a code line). */
  focusBlock(id: string): void;
  /** Mark blocks that produced warnings. */
  showWarnings(warnings: GeneratedProgram['warnings']): void;
  /** Glow the block that live mode is running (null clears it). */
  highlight(id: string | null): void;
  /** Show or hide the category labels (the toolbox keeps its icons). */
  toggleToolbox(): void;
  /** Put the cursor in the block search (expanding the toolbox if needed). */
  focusSearch(): void;
}

interface Props {
  board: BoardDefinition;
  /** Extensions the project has turned on (beyond the board's built-ins). */
  extensions: string[];
  initial: WorkspaceJson;
  theme: ThemeName;
  /** Kept alive but out of sight while the workbench fills the main area. */
  hidden?: boolean;
  /** `load`: Blockly re-serialised what it was given (mount, board switch). `edit`: the learner changed something. */
  onChange(workspace: WorkspaceJson, origin: 'load' | 'edit'): void;
  onSelect(blockId: string | null): void;
}

const START_SCALE = 0.8;
const COLLAPSED_KEY = 'tariro.toolbox.collapsed';
type FlyoutItems = Blockly.utils.toolbox.FlyoutItemInfoArray;

/** Every block the toolbox offers for this board, with the words a learner would search for. */
function searchIndex(board: BoardDefinition, extensions: string[]): Array<{ text: string; item: FlyoutItems[number] }> {
  const out: Array<{ text: string; item: FlyoutItems[number] }> = [];
  const scratch = new Blockly.Workspace();
  try {
    for (const category of registry.toolboxFor(board, extensions)) {
      if (category.custom) continue; // Variables and My Blocks are built by Blockly as the program changes
      const def = buildToolbox([category]) as unknown as { contents: Array<{ contents?: FlyoutItems }> };
      for (const item of def.contents[0]?.contents ?? []) {
        if (item.kind !== 'block') continue;
        let words = String((item as { type?: string }).type ?? '');
        try {
          words = Blockly.serialization.blocks.append(item as unknown as Blockly.serialization.blocks.State, scratch).toString();
        } catch {
          /* fall back to the block type */
        }
        out.push({ text: `${words} ${category.name}`.toLowerCase(), item });
      }
    }
  } finally {
    scratch.dispose();
  }
  return out;
}

export const BlockWorkspace = forwardRef<BlockWorkspaceHandle, Props>(function BlockWorkspace(
  { board, extensions, initial, theme, hidden = false, onChange, onSelect },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const callbacks = useRef({ onChange, onSelect });
  callbacks.current = { onChange, onSelect };
  currentBoard = board;
  const [scale, setScale] = useState(START_SCALE);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const searchInput = useRef<HTMLInputElement>(null);
  const extensionKey = extensions.join(',');

  // Create the workspace once.
  useEffect(() => {
    if (!host.current) return;
    const workspace = Blockly.inject(host.current, {
      toolbox: buildToolbox(registry.toolboxFor(board, extensions)),
      theme: blocklyTheme(theme),
      renderer: 'zelos',
      media: './',
      sounds: true,
      trashcan: true,
      // Our own floating controls replace Blockly's zoom buttons; the wheel and pinch still zoom.
      zoom: { controls: false, wheel: true, pinch: true, startScale: START_SCALE, maxScale: 2, minScale: 0.4, scaleSpeed: 1.12 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 28, length: 2, colour: '#3a3f4b', snap: false },
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
      if (e.type === Blockly.Events.VIEWPORT_CHANGE) {
        setScale(workspace.getScale());
        return;
      }
      // Choosing a category replaces the search results, so the search box is cleared.
      if (e.type === Blockly.Events.TOOLBOX_ITEM_SELECT && (e as Blockly.Events.ToolboxItemSelect).newItem) {
        setQuery('');
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
    // `initial`, `board` and `theme` are only read on first mount; later changes go through the effects below.
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
  useEffect(() => {
    const workspace = ws.current;
    if (!workspace) return;
    workspace.updateToolbox(buildToolbox(registry.toolboxFor(board, extensionKey ? extensionKey.split(',') : [])));
    workspace.refreshToolboxSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- board changes are handled above
  }, [extensionKey]);

  useEffect(() => {
    ws.current?.setTheme(blocklyTheme(theme));
  }, [theme]);

  // Collapsed toolbox: icons only. Blockly must re-measure it once the width has changed, and
  // each row gets a tooltip because its label is hidden.
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* not remembered */
    }
    const workspace = ws.current;
    if (!workspace) return;
    for (const row of host.current?.querySelectorAll('.blocklyToolboxCategory') ?? []) {
      const name = row.querySelector('.blocklyToolboxCategoryLabel')?.textContent;
      if (collapsed && name) row.setAttribute('data-tip', name);
      else row.removeAttribute('data-tip');
    }
    Blockly.svgResize(workspace);
    const t = setTimeout(() => ws.current && Blockly.svgResize(ws.current), 220);
    return () => clearTimeout(t);
  }, [collapsed, board, extensionKey]);

  // Search: show matching blocks in the flyout, ready to drag out.
  const index = useMemo(() => searchIndex(board, extensionKey ? extensionKey.split(',') : []), [board, extensionKey]);
  useEffect(() => {
    const workspace = ws.current;
    const flyout = workspace?.getFlyout();
    if (!workspace || !flyout) return;
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const found = index.filter((e) => words.every((w) => e.text.includes(w))).map((e) => e.item);
    workspace.getToolbox()?.clearSelection();
    flyout.show(found.length ? found : [{ kind: 'label', text: `No blocks match "${query.trim()}"` }]);
  }, [query, index]);

  const clearSearch = useCallback(() => {
    setQuery('');
    ws.current?.getFlyout()?.hide();
  }, []);

  /** Zoom with a short glide instead of a jump. */
  const glide = (act: (w: Blockly.WorkspaceSvg) => void) => {
    const workspace = ws.current;
    if (!workspace) return;
    workspace.beginCanvasTransition();
    act(workspace);
    setTimeout(() => ws.current?.endCanvasTransition(), 260);
  };

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
    toggleToolbox() {
      setCollapsed((c) => !c);
    },
    focusSearch() {
      setCollapsed(false);
      setTimeout(() => searchInput.current?.focus(), 0);
    },
  }));

  return (
    <div className={`workspace-wrap ${collapsed ? 'toolbox-collapsed' : ''}`} hidden={hidden}>
      <div ref={host} className="blockly-host" data-testid="block-workspace" />
      <div className="toolbox-head">
        <label className="block-search">
          <Search className="icon sm" aria-hidden="true" />
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => (e.target.value ? setQuery(e.target.value) : clearSearch())}
            onKeyDown={(e) => e.key === 'Escape' && clearSearch()}
            placeholder="Search blocks…"
            aria-label="Search blocks"
            aria-keyshortcuts="Control+F"
            spellCheck={false}
            data-testid="block-search"
          />
          {query ? (
            <button type="button" className="clear" onClick={clearSearch} aria-label="Clear the search">
              <X className="icon sm" />
            </button>
          ) : (
            <kbd aria-hidden="true">Ctrl F</kbd>
          )}
        </label>
        <button
          type="button"
          className="btn ghost icon-only toolbox-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Show block category names' : 'Hide block category names'}
          aria-pressed={collapsed}
          data-tip={collapsed ? 'Expand the toolbox' : 'Collapse the toolbox'}
          data-keys="Ctrl+B"
          data-testid="toolbox-toggle"
        >
          {collapsed ? <PanelLeftOpen className="icon" /> : <PanelLeftClose className="icon" />}
        </button>
      </div>
      <div className="ws-controls" role="toolbar" aria-label="Workspace view" aria-orientation="vertical">
        <button type="button" className="btn" onClick={() => ws.current?.undo(false)} aria-label="Undo" data-tip="Undo" data-keys="Ctrl+Z" data-testid="ws-undo">
          <Undo2 className="icon" />
        </button>
        <button type="button" className="btn" onClick={() => ws.current?.undo(true)} aria-label="Redo" data-tip="Redo" data-keys="Ctrl+Y" data-testid="ws-redo">
          <Redo2 className="icon" />
        </button>
        <span className="tb-sep" />
        <button type="button" className="btn" onClick={() => glide((w) => w.zoomCenter(1))} aria-label="Zoom in" data-tip="Zoom in" data-testid="ws-zoom-in">
          <ZoomIn className="icon" />
        </button>
        <button
          type="button"
          className="btn zoom-level"
          onClick={() =>
            glide((w) => {
              w.setScale(START_SCALE);
              w.scrollCenter();
            })
          }
          aria-label={`Zoom ${Math.round(scale * 100)} percent. Reset the zoom`}
          data-tip="Reset the zoom"
          data-testid="ws-zoom-level"
        >
          {Math.round(scale * 100)}%
        </button>
        <button type="button" className="btn" onClick={() => glide((w) => w.zoomCenter(-1))} aria-label="Zoom out" data-tip="Zoom out" data-testid="ws-zoom-out">
          <ZoomOut className="icon" />
        </button>
        <button type="button" className="btn" onClick={() => glide((w) => w.zoomToFit())} aria-label="Fit all blocks in view" data-tip="Fit all blocks in view" data-testid="ws-fit">
          <LocateFixed className="icon" />
        </button>
      </div>
    </div>
  );
});
