import { useRef, useState } from 'react';

interface Props {
  /** `col`: a vertical bar dragged left/right. `row`: a horizontal bar dragged up/down. */
  direction: 'col' | 'row';
  /** Current size (px) of the panel after the splitter (right of it, or below it). */
  size: number;
  min: number;
  max: number;
  onResize(size: number): void;
  label: string;
}

/** A draggable divider between two panels. Also works from the keyboard (arrow keys). */
export function Splitter({ direction, size, min, max, onResize, label }: Props) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ pos: 0, size: 0 });
  const clamp = (v: number) => Math.min(Math.max(v, min), Math.max(min, max));
  const pos = (e: { clientX: number; clientY: number }) => (direction === 'col' ? e.clientX : e.clientY);
  return (
    <div
      className={`splitter ${direction} ${dragging ? 'dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-orientation={direction === 'col' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      data-testid={`splitter-${direction}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: pos(e), size };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        // The panel being sized sits after the bar, so dragging towards it makes it smaller.
        if (dragging) onResize(clamp(start.current.size - (pos(e) - start.current.pos)));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        const grow = direction === 'col' ? 'ArrowLeft' : 'ArrowUp';
        const shrink = direction === 'col' ? 'ArrowRight' : 'ArrowDown';
        if (e.key === grow || e.key === shrink) {
          e.preventDefault();
          onResize(clamp(size + (e.key === grow ? 24 : -24)));
        }
      }}
    />
  );
}
