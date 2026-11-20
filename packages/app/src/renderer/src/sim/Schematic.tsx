import { useMemo } from 'react';
import { buildSchematic, type BoardDefinition, type ChainItem, type NetEnd, type Part, type PartState } from '@tariro-studio/core';

const LED_FILL: Record<string, string> = { red: '#ff3b30', yellow: '#ffcc00', green: '#34c759', blue: '#3b9eff', white: '#f5f7ff' };

/** Width of one part in a row, and of a row's ends. */
const STEP = 120;
const END = 96;
const ROW = 64;

interface Props {
  parts: Part[];
  state: Record<string, PartState>;
  board: BoardDefinition;
  /** Press or release a button / flip a switch (0 or 1). */
  onInput(partId: string, value: number): void;
}

/**
 * The circuit diagram (Phase 8b) of the same circuit the workbench and the part list show, with the
 * live state on it: LEDs glow, buttons close while pressed (press them here too), and an LED drawn
 * pointing back towards the pin is in the wrong way round.
 */
export function Schematic({ parts, state, board, onInput }: Props) {
  const s = useMemo(() => buildSchematic(parts, board), [parts, board]);
  const width = Math.max(END * 2 + STEP * Math.max(1, ...s.rows.map((r) => r.items.length)), 360);
  const height = ROW * s.rows.length + 52 * s.others.length + 16;
  if (!s.rows.length && !s.others.length) return null;
  return (
    <svg className="schematic" viewBox={`0 0 ${width} ${height}`} width={width} role="img" aria-label="Circuit diagram" data-testid="sim-schematic">
      {s.rows.map((row, r) => {
        const y = 8 + r * ROW + ROW / 2;
        const last = END + STEP * row.items.length;
        return (
          <g key={`row-${r}`} data-testid="schematic-row">
            <line x1={END - 8} y1={y} x2={last + 8} y2={y} className="sch-wire" />
            <EndMark end={row.from} x={END - 8} y={y} side="left" />
            {row.items.map((item, i) => (
              <Symbol key={item.partId} item={item} part={parts.find((p) => p.id === item.partId)} state={state[item.partId]} cx={END + STEP * i + STEP / 2} cy={y} onInput={onInput} />
            ))}
            <EndMark end={row.to} x={last + 8} y={y} side="right" />
          </g>
        );
      })}
      {s.others.map((o, i) => {
        const y = 8 + s.rows.length * ROW + i * 52 + 26;
        const part = parts.find((p) => p.id === o.partId);
        return (
          <g key={o.partId} data-testid="schematic-other">
            <Symbol item={{ partId: o.partId, kind: o.kind, label: o.label, reversed: false }} part={part} state={state[o.partId]} cx={60} cy={y} onInput={onInput} />
            <text x={130} y={y + 4} className="sch-legs">
              {o.legs.map((l) => `${l.leg} → ${l.to.label}`).join('   ·   ')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EndMark({ end, x, y, side }: { end: NetEnd; x: number; y: number; side: 'left' | 'right' }) {
  if (end.kind === 'gnd')
    return (
      <g className="sch-mark" aria-label="GND">
        <line x1={x} y1={y} x2={x} y2={y + 12} className="sch-wire" />
        <line x1={x - 12} y1={y + 12} x2={x + 12} y2={y + 12} className="sch-wire" />
        <line x1={x - 8} y1={y + 17} x2={x + 8} y2={y + 17} className="sch-wire" />
        <line x1={x - 4} y1={y + 22} x2={x + 4} y2={y + 22} className="sch-wire" />
        <text x={x + 16} y={y + 22} className="sch-note">
          GND
        </text>
      </g>
    );
  if (end.kind === '5v')
    return (
      <g className="sch-mark" aria-label="5V">
        <line x1={x} y1={y} x2={x} y2={y - 14} className="sch-wire" />
        <path d={`M ${x - 7} ${y - 12} L ${x} ${y - 22} L ${x + 7} ${y - 12}`} className="sch-wire" fill="none" />
        <text x={x + 10} y={y - 16} className="sch-note">
          5V
        </text>
      </g>
    );
  // A board pin, a motor terminal or an inner point: a labelled tag.
  const w = Math.max(54, end.label.length * 7 + 14);
  const x0 = side === 'left' ? x - w : x;
  return (
    <g className={`sch-tag ${end.kind}`}>
      <rect x={x0} y={y - 11} width={w} height={22} rx={end.kind === 'pin' ? 4 : 11} />
      <text x={x0 + w / 2} y={y + 4} textAnchor="middle">
        {end.label}
      </text>
    </g>
  );
}

function Symbol({ item, part, state, cx, cy, onInput }: { item: ChainItem; part: Part | undefined; state: PartState | undefined; cx: number; cy: number; onInput(id: string, v: number): void }) {
  const title = <title>{item.reversed ? `${item.label}: drawn the way it is wired, pointing back towards the pin (in backwards)` : item.label}</title>;
  const label = (
    <text x={cx} y={cy + 30} textAnchor="middle" className="sch-label">
      {item.label.length > 22 ? `${item.label.slice(0, 21)}…` : item.label}
    </text>
  );
  const body = (() => {
    switch (item.kind) {
      case 'resistor':
        return <rect x={cx - 20} y={cy - 7} width={40} height={14} className="sch-body" />;
      case 'led': {
        const lit = state?.level ?? 0;
        const colour = part?.kind === 'led' ? LED_FILL[part.colour] : '#ff3b30';
        // The triangle points the way current can flow: away from the pin when wired right.
        const d = item.reversed ? -1 : 1;
        return (
          <g data-testid={`schematic-led-${item.partId}`} data-lit={lit > 0.05 ? 'yes' : 'no'} data-reversed={item.reversed ? 'yes' : 'no'}>
            <rect x={cx - 16} y={cy - 2} width={32} height={4} className="sch-gap" />
            <path d={`M ${cx - 11 * d} ${cy - 11} L ${cx + 9 * d} ${cy} L ${cx - 11 * d} ${cy + 11} Z`} className="sch-body" style={{ fill: lit > 0.05 ? colour : undefined, fillOpacity: lit > 0.05 ? 0.35 + lit * 0.65 : undefined }} />
            <line x1={cx + 9 * d} y1={cy - 11} x2={cx + 9 * d} y2={cy + 11} className="sch-wire" />
            <path d={`M ${cx + 2} ${cy - 13} l 6 -7 m -4 0 l 4 0 l 0 4 M ${cx + 8} ${cy - 10} l 6 -7 m -4 0 l 4 0 l 0 4`} className="sch-wire thin" fill="none" />
            {item.reversed && (
              <text x={cx} y={cy - 18} textAnchor="middle" className="sch-warn">
                backwards
              </text>
            )}
          </g>
        );
      }
      case 'button':
      case 'switch': {
        const closed = (state?.input ?? 0) >= 0.5;
        const press = (v: number) => () => onInput(item.partId, v);
        const handlers = item.kind === 'button' ? { onPointerDown: press(1), onPointerUp: press(0), onPointerLeave: press(0) } : { onClick: press(closed ? 0 : 1) };
        return (
          <g className="sch-press" {...handlers} data-testid={`schematic-press-${item.partId}`} data-closed={closed ? 'yes' : 'no'}>
            <rect x={cx - 22} y={cy - 22} width={44} height={34} fill="transparent" />
            <rect x={cx - 16} y={cy - 2} width={32} height={4} className="sch-gap" />
            <circle cx={cx - 14} cy={cy} r={3} className="sch-dot" />
            <circle cx={cx + 14} cy={cy} r={3} className="sch-dot" />
            {item.kind === 'button' ? (
              <>
                <line x1={cx - 16} y1={closed ? cy - 3 : cy - 12} x2={cx + 16} y2={closed ? cy - 3 : cy - 12} className="sch-wire" />
                <line x1={cx} y1={closed ? cy - 3 : cy - 12} x2={cx} y2={cy - 20} className="sch-wire" />
              </>
            ) : (
              <line x1={cx - 14} y1={cy} x2={cx + 14} y2={closed ? cy - 3 : cy - 14} className="sch-wire" />
            )}
          </g>
        );
      }
      case 'buzzer':
        return (
          <g>
            <rect x={cx - 14} y={cy - 10} width={28} height={20} rx={4} className="sch-body" style={{ fill: (state?.level ?? 0) > 0 ? 'var(--warn-bg)' : undefined }} />
            <text x={cx} y={cy + 4} textAnchor="middle" className="sch-note">
              ♪
            </text>
          </g>
        );
      case 'dc-motor':
        return (
          <g>
            <circle cx={cx} cy={cy} r={13} className="sch-body" />
            <text x={cx} y={cy + 5} textAnchor="middle" className="sch-note">
              M
            </text>
          </g>
        );
      default:
        return (
          <rect x={cx - 24} y={cy - 11} width={48} height={22} rx={4} className="sch-body">
            {title}
          </rect>
        );
    }
  })();
  return (
    <g className="sch-part" data-testid={`schematic-part-${item.partId}`}>
      {title}
      {body}
      {label}
    </g>
  );
}
