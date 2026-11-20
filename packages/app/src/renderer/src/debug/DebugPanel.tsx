import { pinLabel, toText, type BoardDefinition, type PinWatch } from '@tariro-studio/core';
import { CircleHelp, Eraser, Info, Pause, Play, StepForward } from '../ui/icons';
import { debug, useDebugger } from './debugger';

interface Props {
  board: BoardDefinition;
  /** Scroll to a block (the one the program stopped before). */
  onFocusBlock(blockId: string): void;
  /** Open "Why isn't it working?" (8d). */
  onDiagnose(): void;
}

const REASON = { breakpoint: 'at a breakpoint', step: 'after one step', pause: 'because you pressed Pause' } as const;

function pinValue(p: PinWatch): string {
  switch (p.mode) {
    case 'output':
      return p.value ? 'HIGH (set)' : 'LOW (set)';
    case 'pwm':
      return `PWM ${p.value} (${Math.round((p.value / 255) * 100)} %)`;
    case 'servo':
      return `servo ${p.value}°`;
    case 'input':
    case 'input_pullup':
      return `${p.value ? 'HIGH' : 'LOW'} (read${p.mode === 'input_pullup' ? ', pull-up' : ''})`;
    case 'analog':
      return `${p.value} of 1023 (read)`;
  }
}

/**
 * The Debugger tab (Phase 8c): pause, continue and step a block program running on the simulator or
 * a real board, and watch its variables and pins (sensor readings included) while it runs.
 */
export function DebugPanel({ board, onFocusBlock, onDiagnose }: Props) {
  const d = useDebugger();
  const where = d.target === 'live' ? 'the board' : 'the simulator';
  return (
    <div className="debug-panel" data-testid="debug-panel">
      <div className="debug-bar">
        <button type="button" className="btn small" onClick={() => debug.pause()} disabled={!d.target || !!d.paused} data-testid="debug-pause">
          <Pause className="icon sm" />
          Pause
        </button>
        <button type="button" className="btn small primary" onClick={() => debug.resume()} disabled={!d.paused} data-testid="debug-continue">
          <Play className="icon sm" />
          Continue
        </button>
        <button type="button" className="btn small" onClick={() => debug.step()} disabled={!d.paused} data-tip="Run the highlighted block, then stop before the next one" data-testid="debug-step">
          <StepForward className="icon sm" />
          Step
        </button>
        <button type="button" className="btn small ghost" onClick={() => debug.clear()} disabled={!d.breakpoints.size} data-testid="debug-clear">
          <Eraser className="icon sm" />
          Clear breakpoints{d.breakpoints.size ? ` (${d.breakpoints.size})` : ''}
        </button>
        <button type="button" className="btn small ghost" onClick={onDiagnose} data-testid="debug-diagnose">
          <CircleHelp className="icon sm" aria-hidden="true" />
          Why isn’t it working?
        </button>
      </div>
      <p className={`debug-status ${d.paused ? 'paused' : ''}`} role="status" data-testid="debug-status">
        <Info className="icon sm" aria-hidden="true" />
        {d.paused ? (
          <span>
            Stopped {REASON[d.paused.reason]}, before the highlighted block{' '}
            <button type="button" className="link" onClick={() => onFocusBlock(d.paused!.blockId)}>
              (show it)
            </button>
            .{d.target === 'live' ? ' The motors are stopped while the program is paused.' : ''}
          </span>
        ) : d.target ? (
          <span>Running on {where}.</span>
        ) : (
          <span>
            Right-click a block and choose “Add breakpoint”, then press Run in the Simulator tab or Run live. The program stops before that block, and you can step through it one block at a time.
            {d.breakpoints.size ? ` ${d.breakpoints.size} breakpoint${d.breakpoints.size > 1 ? 's' : ''} set.` : ''}
          </span>
        )}
      </p>
      <div className="debug-tables">
        <table data-testid="debug-vars">
          <caption>Variables</caption>
          <tbody>
            {d.variables.length ? (
              d.variables.map((v) => (
                <tr key={`${v.local ? 'l' : 'g'}:${v.name}`}>
                  <th scope="row">
                    {v.name}
                    {v.local ? ' (in this function)' : ''}
                  </th>
                  <td>{v.value === undefined ? <i>not set yet</i> : toText(v.value)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty">No variables yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        <table data-testid="debug-pins">
          <caption>Pins</caption>
          <tbody>
            {d.pins.length ? (
              d.pins.map((p) => (
                <tr key={p.pin}>
                  <th scope="row">Pin {pinLabel(board, `D${p.pin}`)}</th>
                  <td>{pinValue(p)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty">The program has not used a pin yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
