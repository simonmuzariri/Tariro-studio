import { useEffect, useRef } from 'react';
import type { BoardDefinition, ExtensionManifest } from '@tariro-studio/core';
import { BUILT_IN_EXTENSIONS } from '@tariro-studio/extensions';
import { Check, Plus, Puzzle, Trash2 } from 'lucide-react';
import { registry } from '../registry';
import { categoryIcon } from '../ui/categories';

interface Props {
  board: BoardDefinition;
  /** Extensions the project has turned on. */
  enabled: string[];
  /** Extensions whose blocks the program currently uses (cannot be removed). */
  inUse: string[];
  onChange(extensions: string[]): void;
  onClose(): void;
}

const works = (m: ExtensionManifest, board: BoardDefinition) => m.boards === '*' || m.boards.includes(board.id);

/** Add or remove block packs for this project (like PictoBlox's extension library, our own design). */
export function ExtensionLibrary({ board, enabled, inUse, onChange, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const packs = registry.all().filter((m) => !BUILT_IN_EXTENSIONS.has(m.id));
  const on = new Set(enabled);

  return (
    <div className="modal-backdrop">
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Extensions" ref={box}>
        <h2>
          <Puzzle className="icon" aria-hidden="true" />
          Extensions
        </h2>
        <p>Add blocks for the parts in your kit. Extensions are saved with the project.</p>
        <ul className="ext-list">
          {packs.map((m) => {
            const active = on.has(m.id) || inUse.includes(m.id);
            const compatible = works(m, board);
            const locked = inUse.includes(m.id);
            // The pack's first toolbox category gives it its icon and colour.
            const category = m.toolbox[0];
            const Icon = categoryIcon(category?.id ?? m.id);
            return (
              <li key={m.id} className={active ? 'active' : ''} data-testid={`ext-${m.id}`}>
                <span className="tcat-icon" style={{ background: 'var(--brand)' }} aria-hidden="true">
                  <Icon />
                </span>
                <div>
                  <strong>{m.name}</strong>
                  <p>{m.description}</p>
                  <div className="chips">
                    {m.kits?.map((k) => (
                      <span key={k} className="kit-chip">
                        {k} kit
                      </span>
                    ))}
                    {!compatible && <span className="kit-chip warn">not for {board.name}</span>}
                  </div>
                </div>
                {active ? (
                  <button
                    type="button"
                    className="btn plain"
                    disabled={locked}
                    data-tip={locked ? 'Your program uses blocks from this extension' : undefined}
                    onClick={() => onChange(enabled.filter((x) => x !== m.id))}
                  >
                    {locked ? <Check className="icon sm" /> : <Trash2 className="icon sm" />}
                    {locked ? 'In use' : 'Remove'}
                  </button>
                ) : (
                  <button type="button" className="btn solid" disabled={!compatible} onClick={() => onChange([...enabled, m.id])} data-testid={`add-${m.id}`}>
                    <Plus className="icon sm" />
                    Add
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn plain" onClick={onClose} data-testid="ext-close">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
