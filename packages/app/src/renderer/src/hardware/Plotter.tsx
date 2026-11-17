import { useMemo } from 'react';
import { ChartLine, Eraser } from 'lucide-react';
import { t } from '../i18n';
import { parsePlot, plotRange } from './plot';

const COLOURS = ['#e50914', '#3b9eff', '#3fb950', '#b77bff', '#e0a920', '#ff7ab8'];
const W = 600;
const H = 160;

/** Live line chart of the numbers arriving on the Serial Monitor. */
export function Plotter({ text, onClear }: { text: string; onClear(): void }) {
  const data = useMemo(() => parsePlot(text), [text]);
  const { min, max } = plotRange(data);
  const n = data.rows.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - ((v - min) / (max - min)) * H;

  if (n === 0)
    return (
      <p className="empty" data-testid="plot-empty">
        <ChartLine className="icon" style={{ color: 'var(--muted)' }} aria-hidden="true" />
        {t('plot.empty')}
      </p>
    );

  return (
    <div className="plotter" data-testid="plotter">
      <div className="plot-legend">
        {data.series.map((name, s) => {
          const last = [...data.rows].reverse().find((r) => r[s] !== undefined)?.[s];
          return (
            <span key={name} data-testid="plot-series">
              <i style={{ background: COLOURS[s % COLOURS.length] }} /> {name}: <b>{last}</b>
            </span>
          );
        })}
        <button type="button" className="btn ghost small" onClick={onClear}>
          <Eraser className="icon sm" />
          {t('plot.clear')}
        </button>
      </div>
      <div className="plot-area">
        <span className="plot-axis top">{Number(max.toFixed(2))}</span>
        <span className="plot-axis bottom">{Number(min.toFixed(2))}</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Plot of serial values">
          {data.series.map((name, s) => {
            const points = data.rows.flatMap((r, i) => (r[s] === undefined ? [] : [`${x(i).toFixed(1)},${y(r[s]!).toFixed(1)}`]));
            return <polyline key={name} points={points.join(' ')} fill="none" stroke={COLOURS[s % COLOURS.length]} strokeWidth="2" vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
      </div>
    </div>
  );
}
