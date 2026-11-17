import { Box, CircleAlert, CircleCheck, Info, Play, RotateCcw, Square, TriangleAlert, Volume2, VolumeX, Zap } from '../ui/icons';
import { pinLabel, type BoardDefinition, type Part, type PartState } from '@tariro-studio/core';
import type { Simulation } from './useSimulation';
import { PaneTabs, type RightView } from '../ui/PaneTabs';

interface Props {
  simulation: Simulation;
  board: BoardDefinition;
  view: RightView;
  onView(view: RightView): void;
  codeLabel: string;
  /** Set when live mode is using the board highlight: the reason Run is disabled. */
  blocked?: string | undefined;
  /** Open the 3D workbench. */
  onOpenBench(): void;
}

const LED_COLOURS: Record<string, string> = { red: '#ff3b30', yellow: '#ffcc00', green: '#34c759', blue: '#3b9eff', white: '#f5f7ff' };
const fmt = (n: number, digits = 1) => (Math.abs(n) < 0.05 ? '0' : n.toFixed(digits));

/**
 * Simulator view: every part of the circuit with live readings and controls, pin and supply
 * meters, problems, and (for a circuit worked out from the blocks) how to wire it for real.
 */
export function SimulatorPane({ simulation: s, board, view, onView, codeLabel, blocked, onOpenBench }: Props) {
  const { sim, state } = s;
  const visible = sim.circuit.parts.filter((p) => p.kind !== 'resistor' || s.source === 'bench');
  const pins = Object.entries(state.pins);
  const firstError = s.problems.find((p) => p.severity === 'error');

  return (
    <section className="code-pane sim-pane" aria-label="Simulator" hidden={view !== 'sim'} data-testid="simulator">
      <header className="pane-header">
        <PaneTabs view={view} onView={onView} codeLabel={codeLabel} place="sim" />
        <span className="pane-hint">
          {s.running ? (
            <button type="button" className="btn small primary" onClick={s.stop} data-testid="sim-stop">
              <Square className="icon sm" fill="currentColor" />
              Stop
            </button>
          ) : (
            <>
              <button type="button" className="btn small ghost icon-only" onClick={() => sim.reset()} aria-label="Reset the circuit" data-tip="Reset: every pin back to unused" data-testid="sim-reset">
                <RotateCcw className="icon sm" />
              </button>
              <button type="button" className="btn small primary" onClick={() => void s.start()} disabled={!s.canRun} data-tip={blocked ?? firstError?.message ?? 'Run the blocks on the virtual circuit'} data-testid="sim-run">
                <Play className="icon sm" fill="currentColor" />
                Run
              </button>
            </>
          )}
        </span>
      </header>
      <div className="sim-body">
        <p className={`sim-status ${s.running ? 'running' : s.outcome && !s.outcome.ok ? 'bad' : ''}`} role="status" data-testid="sim-status">
          {s.running ? <Zap className="icon sm" aria-hidden="true" /> : s.outcome && !s.outcome.ok ? <CircleAlert className="icon sm" aria-hidden="true" /> : <Info className="icon sm" aria-hidden="true" />}
          <span>
            {s.running
              ? 'Running. Press buttons and move sliders to see the program react.'
              : s.outcome
                ? s.outcome.message
                : s.source === 'bench'
                  ? 'Simulating the circuit you built on the workbench.'
                  : 'These parts are worked out from your blocks and solved as an electrical circuit. Build your own on the workbench.'}
          </span>
        </p>
        <p className="sim-source" data-testid="sim-source">
          <span>Circuit: {s.source === 'bench' ? 'built on the workbench' : 'worked out from the blocks'}</span>
          <button type="button" className="btn small" onClick={onOpenBench} data-testid="sim-open-bench">
            <Box className="icon sm" aria-hidden="true" />
            {s.source === 'bench' ? 'Open workbench' : 'Build it on the workbench'}
          </button>
        </p>

        {[...s.problems.map((p) => ({ message: p.message, severity: p.severity })), ...state.problems.map((m) => ({ message: m, severity: 'warning' as const }))].map((p) => (
          <p key={p.message} className={`sim-problem ${p.severity}`} data-testid="sim-problem">
            <TriangleAlert className="icon sm" aria-hidden="true" />
            <span>{p.message}</span>
          </p>
        ))}

        {visible.length === 0 ? (
          <p className="empty">
            <Info className="icon" style={{ color: 'var(--muted)' }} aria-hidden="true" />
            Add a block that uses a part, for example “turn LED on pin 13 on” from Basic Components, or build a circuit on the workbench.
          </p>
        ) : (
          <ul className="sim-parts">
            {visible.map((part) => (
              <PartCard key={part.id} part={part} state={state.parts[part.id]} onInput={(v) => sim.setInput(part.id, v)} />
            ))}
          </ul>
        )}

        <div className="sim-meters">
          <div className="sim-meter" data-testid="sim-supply">
            <span>5 V supply</span>
            <b>{fmt(state.supplyMilliamps)} mA</b>
          </div>
          {pins.map(([node, pin]) => (
            <div key={node} className="sim-meter" data-testid={`sim-pin-${pinLabel(board, node)}`}>
              <span>
                Pin {pinLabel(board, node)} · {pin.mode === 'pwm' ? 'PWM' : pin.mode === 'input_pullup' ? 'input, pull-up' : pin.mode}
              </span>
              <b>
                {fmt(pin.volts, 2)} V{pin.mode === 'output' || pin.mode === 'pwm' ? ` · ${fmt(pin.milliamps)} mA` : ''}
              </b>
            </div>
          ))}
        </div>

        {s.wiring.length > 0 && (
          <details className="sim-wiring" data-testid="sim-wiring">
            <summary>How to wire this on a real breadboard</summary>
            <ol>
              {s.wiring.map((w) => (
                <li key={w.partId}>
                  <b>{w.title}.</b> {w.how}
                </li>
              ))}
            </ol>
            <p>Check the real board against this list before powering it. The simulator and a real circuit can differ; for example it does not model loose wires or a flat battery.</p>
          </details>
        )}
      </div>
    </section>
  );
}

export { LED_COLOURS };

function PartCard({ part, state, onInput }: { part: Part; state: PartState | undefined; onInput(value: number): void }) {
  const level = state?.level ?? 0;
  const input = state?.input ?? 0;
  return (
    <li className={`sim-part kind-${part.kind} ${state?.problem ? 'has-problem' : ''}`} data-testid={`sim-part-${part.id}`} data-level={level.toFixed(2)}>
      <div className="sim-visual" aria-hidden="true">
        {part.kind === 'resistor' && <span className="sim-resistor" />}
        {part.kind === 'led' && <span className="sim-led" style={{ '--led': LED_COLOURS[part.colour], '--glow': level } as React.CSSProperties} />}
        {part.kind === 'buzzer' && (level > 0 ? <Volume2 className="icon sim-on" /> : <VolumeX className="icon" />)}
        {part.kind === 'logic-load' && <span className={`sim-relay ${level > 0 ? 'on' : ''}`}>{level > 0 ? 'ON' : 'OFF'}</span>}
        {part.kind === 'motor' && (
          <span className="sim-wheel" style={{ animationDuration: level === 0 ? '0s' : `${(0.5 / Math.abs(level)).toFixed(2)}s`, animationDirection: level < 0 ? 'reverse' : 'normal' }}>
            <i />
          </span>
        )}
        {(part.kind === 'button' || part.kind === 'switch' || part.kind === 'signal') && <span className={`sim-contact ${input >= 0.5 ? 'closed' : ''}`} />}
        {part.kind === 'potentiometer' && <span className="sim-knob" style={{ transform: `rotate(${-135 + input * 270}deg)` }} />}
      </div>
      <div className="sim-info">
        <strong>{part.label}</strong>
        <span className="sim-reading">
          {part.kind === 'led' && `${fmt(state?.volts ?? 0, 2)} V · ${fmt(state?.milliamps ?? 0)} mA`}
          {part.kind === 'resistor' && `${fmt(state?.volts ?? 0, 2)} V · ${fmt(state?.milliamps ?? 0)} mA`}
          {part.kind === 'buzzer' && (level > 0 ? `sounding · ${fmt(state?.milliamps ?? 0)} mA` : 'silent')}
          {part.kind === 'logic-load' && `input ${fmt(state?.volts ?? 0, 2)} V`}
          {part.kind === 'motor' && (level === 0 ? 'stopped' : `${level > 0 ? 'forward' : 'backward'} · ${Math.round(Math.abs(level) * 100)} %`)}
          {part.kind === 'potentiometer' && `${fmt(state?.volts ?? 0, 2)} V at the pin`}
          {(part.kind === 'button' || part.kind === 'switch') && (input >= 0.5 ? 'closed' : 'open')}
          {part.kind === 'signal' && `output ${fmt(state?.volts ?? 0, 2)} V`}
        </span>
        {state?.problem && (
          <span className="sim-part-problem">
            <TriangleAlert className="icon sm" aria-hidden="true" /> too much current
          </span>
        )}
      </div>
      <div className="sim-control">
        {part.kind === 'button' && (
          <button
            type="button"
            className={`btn small ${input >= 0.5 ? 'primary' : ''}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              onInput(1);
            }}
            onPointerUp={() => onInput(0)}
            onPointerCancel={() => onInput(0)}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && onInput(1)}
            onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && onInput(0)}
            data-testid={`sim-input-${part.id}`}
          >
            Hold to press
          </button>
        )}
        {(part.kind === 'switch' || part.kind === 'signal') && (
          <label className="check">
            <input type="checkbox" checked={input >= 0.5} onChange={(e) => onInput(e.target.checked ? 1 : 0)} data-testid={`sim-input-${part.id}`} />
            {part.kind === 'switch' ? 'on' : 'detects something'}
          </label>
        )}
        {part.kind === 'potentiometer' && (
          <input type="range" min={0} max={100} value={Math.round(input * 100)} onChange={(e) => onInput(Number(e.target.value) / 100)} aria-label={`${part.label} position`} data-testid={`sim-input-${part.id}`} />
        )}
        {(part.kind === 'led' || part.kind === 'buzzer' || part.kind === 'logic-load' || part.kind === 'motor') && (level !== 0 ? <CircleCheck className="icon sim-on" aria-label="on" /> : null)}
      </div>
    </li>
  );
}
