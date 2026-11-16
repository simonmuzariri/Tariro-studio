import { useEffect, useRef, type ReactNode } from 'react';
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
}

/** Bottom of the code column: Problems · Output · Serial Monitor. */
export function Dock({ tab, onTab, problems, onProblemClick, log, onClearLog, serial, plotter }: Props) {
  const errors = problems.filter((p) => p.severity === 'error').length;
  const tabs: Array<[DockTab, string]> = [
    ['problems', problems.length ? t('dock.problemsCount', { count: problems.length }) : t('dock.problems')],
    ['output', t('dock.output')],
    ['serial', t('dock.serial')],
    ['plotter', t('dock.plotter')],
  ];
  return (
    <section className="dock" aria-label="Problems, output and serial monitor">
      <div className="dock-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className={`dock-tab ${tab === id ? 'active' : ''} ${id === 'problems' && errors ? 'has-errors' : ''}`}
            onClick={() => onTab(id)}
            data-testid={`tab-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dock-body" role="tabpanel">
        {tab === 'problems' && <ProblemList problems={problems} onClick={onProblemClick} />}
        {tab === 'output' && <Output log={log} onClear={onClearLog} />}
        {tab === 'serial' && serial}
        {tab === 'plotter' && plotter}
      </div>
    </section>
  );
}

function ProblemList({ problems, onClick }: { problems: Problem[]; onClick(p: Problem): void }) {
  if (problems.length === 0) return <p className="ok" data-testid="warnings">{t('dock.noProblems')}</p>;
  return (
    <ul className="problems" data-testid="warnings">
      {problems.map((p, i) => (
        <li key={i} className={p.severity}>
          <button type="button" className="link" onClick={() => onClick(p)} disabled={!p.blockId && !p.line}>
            <span className="tag">{p.source === 'compiler' ? `compiler${p.line ? ` · line ${p.line}` : ''}` : p.source === 'live' ? 'live' : 'blocks'}</span> {p.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Output({ log, onClear }: { log: LogLine[]; onClear(): void }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return (
    <div className="output">
      <button type="button" className="btn small clear" onClick={onClear}>
        Clear
      </button>
      <pre ref={ref} data-testid="output-log">
        {log.map((l) => (
          <span key={l.id} className={`log-${l.stream}`}>
            {l.line}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  );
}
