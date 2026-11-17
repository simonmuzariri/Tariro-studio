import { useEffect, useRef, useState } from 'react';
import type { BoardDefinition } from '@tariro-studio/core';
import { Check, ChevronDown, Cpu } from '../ui/icons';

interface Props {
  boards: readonly BoardDefinition[];
  /** The board the project is for. */
  board: BoardDefinition;
  onChoose(boardId: string): void;
  disabled?: boolean;
}

/** Board: a menu of the boards Tariro Studio can program; the current one is ticked. */
export function BoardButton({ boards, board, onChoose, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="tb-menu" ref={box}>
      <button
        type="button"
        className="btn tb-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? {} : { 'data-tip': `Board: ${board.name}. Click to choose another.` })}
        data-board={board.id}
        data-testid="board-button"
      >
        <Cpu className="icon" aria-hidden="true" />
        <span>Board</span>
        <ChevronDown className="icon xs" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu board-menu" role="menu" data-testid="board-menu">
          <p className="menu-heading">Choose your board</p>
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitemradio"
              aria-checked={b.id === board.id}
              className={`menu-item${b.id === board.id ? ' current' : ''}`}
              onClick={() => {
                setOpen(false);
                if (b.id !== board.id) onChoose(b.id);
              }}
              data-testid={`board-${b.id}`}
            >
              <Cpu className="icon" aria-hidden="true" />
              <span className="board-item">
                <b>{b.name}</b>
                <small>{b.vendor}</small>
              </span>
              {b.id === board.id && <Check className="icon sm" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
