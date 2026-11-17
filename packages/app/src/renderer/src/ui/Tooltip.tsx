import { useEffect, useRef, useState } from 'react';

interface Tip {
  text: string;
  keys?: string;
  x: number;
  y: number;
  above: boolean;
}

/**
 * One tooltip for the whole app: any element with `data-tip` (and optionally `data-keys` for a
 * shortcut) gets it on hover or keyboard focus. It is drawn in a fixed layer, so it is never
 * clipped by a toolbar or panel.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    let shownText: string | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const show = (el: Element, delay: number) => {
      if (el === current) return;
      clearTimeout(timer);
      current = el;
      timer = setTimeout(() => {
        const text = el.getAttribute('data-tip');
        shownText = text;
        if (!text || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 44 > window.innerHeight;
        const keys = el.getAttribute('data-keys');
        setShift(0);
        setTip({ text, ...(keys ? { keys } : {}), x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above });
      }, delay);
    };
    const over = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el) show(el, e.type === 'focusin' ? 0 : 450);
      else hide();
    };
    // A control can be swapped for another under a still pointer (Run becomes Stop): drop its tooltip.
    const check = setInterval(() => {
      // React may also reuse the same element with a different tooltip (Run becomes Stop).
      if (current && (!current.isConnected || current.getAttribute('data-tip') !== shownText)) hide();
    }, 250);
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', over);
    document.addEventListener('focusout', hide);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', hide);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      clearInterval(check);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Keep the tooltip inside the window.
  useEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    const overflowRight = r.right - (window.innerWidth - 8);
    const next = overflowRight > 0 ? -overflowRight : r.left < 8 ? 8 - r.left : 0;
    if (next !== 0) setShift((s) => s + next);
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} className="tooltip" role="tooltip" style={{ left: tip.x + shift, top: tip.y, transform: `translate(-50%, ${tip.above ? '-100%' : '0'})` }}>
      {tip.text}
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>
  );
}
