import { useEffect, useRef, type ReactNode } from 'react';
import { ChartLine, CircleAlert, CircleCheck, CircleX, Eraser, Info, LoaderCircle, PanelBottomClose, PanelBottomOpen, PlugZap, ScrollText, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { LogLine } from './useHardware';
import { t } from '../i18n';

export interface Problem {
  severity: 'error' | 'warning';
  source: 'blocks' | 'compiler' | 'live';
  message: string;
  blockId?: string;
  line?: number;
}

export type DockTab = 'problems' | 'output' | 'serial' | 'plotter';

interface Props {
  tab: DockTab;
  onTab(tab: DockTab): void;
  problems: Problem[];
  onProblemClick(p: Problem): void;
  log: LogLine[];
  onClearLog(): void;
  serial: ReactNode;
  plotter: ReactNode;
  collapsed: boolean;
  onToggleCollapsed(): void;
  /** What the toolchain or live mode is doing, for the status badge. */
  activity: { state: 'ready' | 'busy' | 'failed'; label: string };
}

const TABS: Array<[DockTab, LucideIcon, 'dock.problems' | 'dock.output' | 'dock.serial' | 'dock.plotter']> = [
  ['problems', CircleAlert, 'dock.problems'],
  ['output', ScrollText, 'dock.output'],
  ['serial', PlugZap, 'dock.serial'],
  ['plotter', ChartLine, 'dock.plotter'],
];

/** Bottom of the code column: Problems · Output · Serial Monitor · Plotter. */
export function Dock({ tab, onTab, problems, onProblemClick, log, onClearLog, serial, plotter, collapsed, onToggleCollapsed, activity }: Props) {
  const errors = problems.filter((p) => p.severity === 'error').length;
  return (
    <section className="dock" aria-label="Problems, output and serial monitor">
      <div className="dock-tabs" role="tablist">
        {TABS.map(([id, Icon, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={!collapsed && tab === id}
            className={`dock-tab tab-${id} ${!collapsed && tab === id ? 'active' : ''} ${id === 'problems' && errors ? 'has-errors' : id === 'problems' && problems.length ? 'has-warnings' : ''}`}
            onClick={() => {
              onTab(id);
              if (collapsed) onToggleCollapsed();
            }}
            data-testid={`tab-${id}`}
          >
            <Icon className="icon sm" aria-hidden="true" />
            {id === 'problems' && problems.length ? t('dock.problemsCount', { count: problems.length }) : t(label)}
          </button>
        ))}
        <div className="dock-tools">
          <span className={`badge ${activity.state}`} role="status" data-testid="activity-badge">
            {activity.state === 'busy' ? <LoaderCircle className="icon sm spin" aria-hidden="true" /> : activity.state === 'failed' ? <CircleX className="icon sm" aria-hidden="true" /> : <CircleCheck className="icon sm" aria-hidden="true" />}
            {activity.label}
          </span>
          <button
            type="button"
            className="btn ghost small icon-only"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Show the panel' : 'Hide the panel'}
            aria-expanded={!collapsed}
            data-tip={collapsed ? 'Show the panel' : 'Hide the panel'}
            data-keys="Ctrl+J"
            data-testid="dock-toggle"
          >
            {collapsed ? <PanelBottomOpen className="icon" /> : <PanelBottomClose className="icon" />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="dock-body" role="tabpanel" key={tab}>
          {tab === 'problems' && <ProblemList problems={problems} onClick={onProblemClick} />}
          {tab === 'output' && <Output log={log} onClear={onClearLog} />}
          {tab === 'serial' && serial}
          {tab === 'plotter' && plotter}
        </div>
      )}
    </section>
  );
}

function ProblemList({ problems, onClick }: { problems: Problem[]; onClick(p: Problem): void }) {
  if (problems.length === 0)
    return (
      <p className="empty" data-testid="warnings">
        <CircleCheck className="icon" aria-hidden="true" />
        {t('dock.noProblems')}
      </p>
    );
  return (
    <ul className="problems" data-testid="warnings">
      {problems.map((p, i) => (
        <li key={i} className={p.severity}>
          <button type="button" onClick={() => onClick(p)} disabled={!p.blockId && !p.line}>
            {p.severity === 'error' ? <CircleX className="icon sm" aria-label="Error" /> : <TriangleAlert className="icon sm" aria-label="Warning" />}
            <span className="tag">{p.source === 'compiler' ? `compiler${p.line ? ` · line ${p.line}` : ''}` : p.source === 'live' ? 'live' : 'blocks'}</span>{' '}
            <span>{p.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Our own lines get a marker: green for a good outcome, red for a bad one, blue for progress. */
function lineKind(l: LogLine): 'ok' | 'bad' | 'info' | 'plain' {
  if (l.stream !== 'info') return 'plain';
  if (/^(Compiled successfully|Uploaded!|Saved to the board|Support for .* is installed|Connected to|Live: the program finished)/.test(l.line)) return 'ok';
  if (/(could not|failed|did not answer|not available|cancelled|error|was not found|needs the live firmware)/i.test(l.line)) return 'bad';
  return 'info';
}
const LINE_ICON = { ok: CircleCheck, bad: CircleX, info: Info } as const;

function Output({ log, onClear }: { log: LogLine[]; onClear(): void }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return (
    <div className="output">
      <button type="button" className="btn ghost small icon-only clear" onClick={onClear} aria-label="Clear the output" data-tip="Clear the output">
        <Eraser className="icon sm" />
      </button>
      <pre ref={ref} data-testid="output-log">
        {log.map((l) => {
          const kind = lineKind(l);
          const Icon = kind === 'plain' ? undefined : LINE_ICON[kind];
          return (
            <span key={l.id} className={`log-line log-${l.stream} ${kind === 'plain' ? '' : `log-${kind}`}`}>
              {Icon && <Icon className="icon sm" aria-hidden="true" />}
              {l.line}
              {'\n'}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
