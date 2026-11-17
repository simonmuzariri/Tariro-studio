import { CircuitBoard, FileCode2 } from 'lucide-react';

export type RightView = 'code' | 'sim';

/** The two views of the right-hand panel: the generated code and the simulator. */
/** `place` keeps test ids unique: both panels draw this strip, and only one is visible at a time. */
export function PaneTabs({ view, onView, codeLabel, place = 'code' }: { view: RightView; onView(view: RightView): void; codeLabel: string; place?: 'code' | 'sim' }) {
  return (
    <div className="pane-tabs" role="tablist" aria-label="Code or simulator">
      <button type="button" role="tab" aria-selected={view === 'code'} className={`pane-tab ${view === 'code' ? 'active' : ''}`} onClick={() => onView('code')} data-testid={place === 'code' ? 'code-title' : 'sim-tab-code'}>
        <FileCode2 className="icon sm" aria-hidden="true" />
        <span>{codeLabel}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'sim'}
        className={`pane-tab ${view === 'sim' ? 'active' : ''}`}
        onClick={() => onView('sim')}
        data-tip="Run the blocks on a virtual circuit"
        data-testid={place === 'code' ? 'tab-simulator' : 'sim-tab-simulator'}
      >
        <CircuitBoard className="icon sm" aria-hidden="true" />
        <span>Simulator</span>
      </button>
    </div>
  );
}
