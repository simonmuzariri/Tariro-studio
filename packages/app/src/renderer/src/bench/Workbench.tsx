import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Cable,
  CircleDot,
  Eye,
  Gauge,
  Lightbulb,
  MousePointer2,
  Play,
  RotateCw,
  Square,
  SquareDot,
  ToggleLeft,
  Trash2,
  TriangleAlert,
  Volume2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import {
  boardPinOrder,
  canPlace,
  emptyLayout,
  firstFreeSpot,
  formatOhms,
  freeHoleInStrip,
  layoutFromCircuit,
  legHoles,
  PART_KINDS,
  pinLabel,
  ROWS,
  WIRE_COLOURS,
  type BoardDefinition,
  type CircuitLayout,
  type PlaceableKind,
  type PlacedPart,
  type WorkspaceJson,
} from '@tariro-studio/core';
import { deriveCircuit } from '@tariro-studio/extensions';
import type { Simulation } from '../sim/useSimulation';
import type { ThemeName } from '../ui/theme';
import { BenchScene, type BenchMode, type Probe } from './scene';
import { Instruments, type ProbeSlot } from './Instruments';

interface Props {
  board: BoardDefinition;
  workspace: WorkspaceJson;
  theme: ThemeName;
  layout: CircuitLayout | undefined;
  onChange(layout: CircuitLayout): void;
  simulation: Simulation;
  /** Why the program cannot be run now (live mode is using the board). */
  blocked?: string | undefined;
}

const PALETTE: Array<[PlaceableKind, LucideIcon, string]> = [
  ['led', Lightbulb, 'LED'],
  ['resistor', SquareDot, 'Resistor'],
  ['button', CircleDot, 'Push button'],
  ['switch', ToggleLeft, 'Slide switch'],
  ['potentiometer', RotateCw, 'Potentiometer'],
  ['buzzer', Volume2, 'Buzzer'],
];
const OHMS = [100, 220, 330, 470, 1000, 2200, 4700, 10_000, 47_000, 100_000];
const POT_OHMS = [1000, 10_000, 100_000];
const COLOURS = ['red', 'yellow', 'green', 'blue', 'white'] as const;
const WIRE_NAMES: Record<string, string> = { '#e53935': 'red', '#212121': 'black', '#1e88e5': 'blue', '#43a047': 'green', '#fdd835': 'yellow', '#fb8c00': 'orange', '#8e24aa': 'purple', '#f5f5f5': 'white' };

let counter = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A readable name for a simulator node: "pin 13", "GND", "5V" or "nothing on the board". */
function nodeName(board: BoardDefinition, node: string | undefined, links = 0): string {
  if (!node) return 'not connected to anything';
  if (node.startsWith('net:')) return links > 1 ? 'joined to other parts, not straight to a board pin' : 'not connected to anything';
  if (node === 'GND' || node === '5V') return node;
  return `pin ${pinLabel(board, node)}`;
}

/**
 * The 3D workbench: build a circuit on a breadboard next to the board, then run the blocks on it.
 * Parts are added from the palette at the first free place and dragged to move; wires are drawn
 * by clicking two connection points, or added from the properties panel with a pin picker.
 */
export default function Workbench({ board, workspace, theme, layout: stored, onChange, simulation: sim, blocked }: Props) {
  const layout = useMemo(() => stored ?? emptyLayout(), [stored]);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<BenchScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [mode, setMode] = useState<BenchMode>({ kind: 'select' });
  const [wireColour, setWireColour] = useState<string>(WIRE_COLOURS[2]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [instrumentsOpen, setInstrumentsOpen] = useState(false);
  const [probeSlot, setProbeSlot] = useState<ProbeSlot | null>(null);
  const probeHandler = useRef<((conn: string | undefined, partId: string | undefined) => void) | null>(null);
  const showProbes = useCallback((probes: Probe[]) => scene.current?.setProbes(probes), []);
  const registerProbe = useCallback((fn: ((conn: string | undefined, partId: string | undefined) => void) | null) => {
    probeHandler.current = fn;
  }, []);
  const live = useRef({ layout, onChange, sim, board });
  const wireColourRef = useRef(wireColour);
  useEffect(() => {
    live.current = { layout, onChange, sim, board };
    wireColourRef.current = wireColour;
  });

  const update = useCallback((next: CircuitLayout) => live.current.onChange(next), []);

  // Create the scene once; it reports what the learner does through these callbacks.
  useEffect(() => {
    if (!host.current) return;
    try {
      scene.current = new BenchScene(
        host.current,
        live.current.board,
        {
          select: (id) => setSelected(id),
          place: (kind, row, col, rotation) => {
            const l = live.current.layout;
            const id = newId(kind);
            update({ ...l, parts: [...l.parts, { id, kind, row, col, rotation, ...(kind === 'led' ? { colour: 'red' as const } : {}), ...(kind === 'resistor' ? { ohms: 220 } : {}) }] });
            setSelected(id);
          },
          move: (id, row, col) => {
            const l = live.current.layout;
            update({ ...l, parts: l.parts.map((p) => (p.id === id ? { ...p, row, col } : p)) });
          },
          wire: (from, to) => {
            const l = live.current.layout;
            const id = newId('wire');
            update({ ...l, wires: [...l.wires, { id, from, to, colour: wireColourRef.current }] });
          },
          operate: (partId, value) => live.current.sim.sim.setInput(partId, value),
          probe: (conn, partId) => probeHandler.current?.(conn, partId),
          hover: setHover,
          canPlace: (p, except) => canPlace(live.current.layout, p, except),
          describe: (id) => {
            const node = live.current.sim.nodeAt(id);
            return nodeName(live.current.board, node, node ? live.current.sim.linksOn(node) : 0);
          },
        },
        theme,
      );
      // The palette (left) and the properties panel (right) float over the view.
      scene.current.setInsets(172, 284);
      // Test hook: where a hole or pin is on screen, so automated tests can click it in 3D.
      (window as unknown as { __tariroBench?: unknown }).__tariroBench = { screenOf: (id: string) => scene.current?.screenOf(id) };
    } catch (e) {
      // No WebGL (an old graphics driver): say so after this render instead of showing a blank area.
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setFailed(message));
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
    // The scene is created once; later changes are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // With the instruments open the properties panel steps aside, so the bench centres in more room.
  useEffect(() => scene.current?.setInsets(172, instrumentsOpen ? 12 : 284), [instrumentsOpen]);
  useEffect(() => scene.current?.setTheme(theme), [theme]);
  useEffect(() => scene.current?.setBoard(board), [board]);
  useEffect(() => scene.current?.setLayout(layout), [layout]);
  useEffect(() => scene.current?.setSelection(selected), [selected, layout]);
  // Placing a probe takes over the bench until the point is chosen.
  useEffect(() => scene.current?.setMode(probeSlot ? { kind: 'probe' } : mode), [mode, probeSlot]);
  useEffect(() => scene.current?.setSimulation(sim.state, sim.running));

  const part = layout.parts.find((p) => p.id === selected);
  const wire = layout.wires.find((w) => w.id === selected);

  const addPart = (kind: PlaceableKind) => {
    const spot = firstFreeSpot(layout, kind);
    if (!spot) return setNotice('The breadboard is full. Remove a part to make room.');
    const id = newId(kind);
    update({ ...layout, parts: [...layout.parts, { id, kind, ...spot, ...(kind === 'led' ? { colour: 'red' as const } : {}), ...(kind === 'resistor' ? { ohms: 220 } : {}), ...(kind === 'potentiometer' ? { ohms: 10_000 } : {}) }] });
    setSelected(id);
    setMode({ kind: 'select' });
    setNotice(`${PART_KINDS[kind].name} added. Drag it to move it.`);
  };
  const patchPart = (id: string, patch: Partial<PlacedPart>) => update({ ...layout, parts: layout.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const remove = useCallback(() => {
    const l = live.current.layout;
    if (!selected) return;
    update({ ...l, parts: l.parts.filter((p) => p.id !== selected), wires: l.wires.filter((w) => w.id !== selected) });
    setSelected(null);
  }, [selected, update]);
  const rotate = useCallback(() => {
    const l = live.current.layout;
    const p = l.parts.find((x) => x.id === selected);
    if (!p) return;
    const rotation = p.rotation === 0 ? 90 : 0;
    if (!canPlace(l, { ...p, rotation }, p.id)) return setNotice('There is no room to turn it here. Move it first.');
    update({ ...l, parts: l.parts.map((x) => (x.id === p.id ? { ...x, rotation } : x)) });
  }, [selected, update]);
  const wireLegTo = (hole: string, pin: string) => {
    const from = freeHoleInStrip(layout, hole);
    if (!from) return setNotice('Every hole in that column is taken. Move the part to a column with a free hole.');
    update({ ...layout, wires: [...layout.wires, { id: newId('wire'), from, to: pin, colour: pin === 'pin:GND' ? WIRE_COLOURS[1] : pin === 'pin:5V' ? WIRE_COLOURS[0] : wireColour }] });
    setNotice(`Wire added from ${from.slice(3)} to ${pin === 'pin:GND' || pin === 'pin:5V' ? pin.slice(4) : `pin ${pin.slice(4)}`}.`);
  };
  const buildFromBlocks = () => {
    const { layout: built, skipped } = layoutFromCircuit(deriveCircuit(workspace, board).circuit, board);
    if (built.parts.length === 0) return setNotice('Your blocks do not use any part the workbench has yet (LEDs, buttons, switches, potentiometers, buzzers).');
    update(built);
    setSelected(null);
    setNotice(`Built ${built.parts.length} parts and ${built.wires.length} wires from your blocks.${skipped.length ? ` Not on the workbench yet: ${skipped.join(', ')}.` : ''}`);
  };

  // Keyboard: Delete removes, R turns, W wires, Escape cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') remove();
      else if (e.key === 'r' || e.key === 'R') rotate();
      else if (e.key === 'w' || e.key === 'W') setMode((m) => (m.kind === 'wire' ? { kind: 'select' } : { kind: 'wire', colour: wireColourRef.current }));
      else if (e.key === 'Escape') {
        setProbeSlot(null);
        setMode({ kind: 'select' });
        setSelected(null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [remove, rotate]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const partState = (id: string) => sim.state.parts[id];
  const labelOf = (id: string) => sim.sim.circuit.parts.find((p) => p.id === id)?.label ?? id;
  const pinOptions = boardPinOrder(board);
  const benchProblems = sim.source === 'bench' ? sim.problems : sim.problems.filter((p) => p.severity === 'error' && !p.partId);

  return (
    <div className={`bench ${instrumentsOpen ? 'inst-open' : ''}`} data-testid="workbench">
      <div ref={host} className="bench-view" />
      {failed && (
        <p className="bench-failed">
          <TriangleAlert className="icon" aria-hidden="true" />
          The 3D view could not start on this computer ({failed}). The Simulator tab still works.
        </p>
      )}

      <aside className="bench-palette" aria-label="Parts">
        <span className="bench-heading">Parts</span>
        {PALETTE.map(([kind, Icon, name]) => (
          <button key={kind} type="button" className="bench-tool" onClick={() => addPart(kind)} disabled={sim.running} data-tip={`Add a ${name.toLowerCase()} to the breadboard`} data-testid={`bench-add-${kind}`}>
            <Icon className="icon" aria-hidden="true" />
            <span>{name}</span>
          </button>
        ))}
        <span className="bench-heading">Tools</span>
        <button
          type="button"
          className={`bench-tool ${instrumentsOpen ? 'active' : ''}`}
          onClick={() => {
            setInstrumentsOpen((o) => !o);
            setProbeSlot(null);
          }}
          aria-pressed={instrumentsOpen}
          data-tip="Multimeter, oscilloscope and logic view"
          data-testid="bench-tool-instruments"
        >
          <Gauge className="icon" aria-hidden="true" />
          <span>Instruments</span>
        </button>
        <button type="button" className={`bench-tool ${mode.kind === 'select' ? 'active' : ''}`} onClick={() => setMode({ kind: 'select' })} aria-pressed={mode.kind === 'select'} data-tip="Select and drag parts" data-keys="Esc" data-testid="bench-tool-select">
          <MousePointer2 className="icon" aria-hidden="true" />
          <span>Select</span>
        </button>
        <button
          type="button"
          className={`bench-tool ${mode.kind === 'wire' ? 'active' : ''}`}
          onClick={() => setMode(mode.kind === 'wire' ? { kind: 'select' } : { kind: 'wire', colour: wireColour })}
          aria-pressed={mode.kind === 'wire'}
          disabled={sim.running}
          data-tip="Draw a wire: click a hole or pin, then another"
          data-keys="W"
          data-testid="bench-tool-wire"
        >
          <Cable className="icon" aria-hidden="true" />
          <span>Wire</span>
        </button>
        {mode.kind === 'wire' && (
          <div className="bench-swatches" role="radiogroup" aria-label="Wire colour">
            {WIRE_COLOURS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === wireColour} aria-label={WIRE_NAMES[c]} className={`swatch ${c === wireColour ? 'on' : ''}`} style={{ background: c }} onClick={() => setWireColour(c)} />
            ))}
          </div>
        )}
      </aside>

      <div className="bench-top">
        {sim.running ? (
          <button type="button" className="btn small primary" onClick={sim.stop} data-testid="bench-stop">
            <Square className="icon sm" fill="currentColor" />
            Stop
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={() => void sim.start()} disabled={!sim.canRun} data-tip={blocked ?? sim.problems.find((p) => p.severity === 'error')?.message ?? 'Run the blocks on this circuit'} data-testid="bench-run">
            <Play className="icon sm" fill="currentColor" />
            Run
          </button>
        )}
        <span className="tb-sep" />
        <button type="button" className="btn small ghost" onClick={buildFromBlocks} disabled={sim.running} data-tip="Lay out the parts your blocks use, with their wires" data-testid="bench-build">
          <Wand2 className="icon sm" />
          Build from blocks
        </button>
        <button type="button" className="btn small ghost icon-only" onClick={() => scene.current?.resetView()} aria-label="Reset the view" data-tip="Reset the view">
          <Box className="icon sm" />
        </button>
        <button type="button" className="btn small ghost icon-only" onClick={() => scene.current?.topView()} aria-label="View from above" data-tip="View from above">
          <Eye className="icon sm" />
        </button>
        <button
          type="button"
          className="btn small ghost icon-only"
          onClick={() => {
            update(emptyLayout());
            setSelected(null);
          }}
          disabled={sim.running || (layout.parts.length === 0 && layout.wires.length === 0)}
          aria-label="Clear the bench"
          data-tip="Clear the bench"
          data-testid="bench-clear"
        >
          <Trash2 className="icon sm" />
        </button>
      </div>

      <aside className="bench-props" aria-label="Properties" data-testid="bench-props">
        {part ? (
          <>
            <h3>{labelOf(part.id)}</h3>
            <p className="bench-muted">
              First leg in hole {ROWS[part.row]}
              {part.col}
              {part.rotation === 90 ? ', turned' : ''}
            </p>
            {part.kind === 'led' && (
              <label className="bench-field">
                Colour
                <select value={part.colour ?? 'red'} onChange={(e) => patchPart(part.id, { colour: e.target.value as (typeof COLOURS)[number] })} disabled={sim.running}>
                  {COLOURS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(part.kind === 'resistor' || part.kind === 'potentiometer') && (
              <label className="bench-field">
                Resistance
                <select value={part.ohms ?? (part.kind === 'resistor' ? 220 : 10_000)} onChange={(e) => patchPart(part.id, { ohms: Number(e.target.value) })} disabled={sim.running} data-testid="bench-ohms">
                  {(part.kind === 'resistor' ? OHMS : POT_OHMS).map((o) => (
                    <option key={o} value={o}>
                      {formatOhms(o)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Readings id={part.id} sim={sim} />
            {sim.running && <Operate part={part} sim={sim} />}
            <ul className="bench-legs">
              {PART_KINDS[part.kind].legs.map((leg, i) => {
                const hole = legHoles(part)?.[i];
                return (
                  <li key={leg.name}>
                    <span>
                      <b>{leg.name}</b> in {hole?.slice(3)}: {nodeName(board, hole ? sim.nodeAt(hole) : undefined, hole ? sim.linksOn(sim.nodeAt(hole) ?? '') : 0)}
                    </span>
                    {hole && !sim.running && (
                      <select value="" onChange={(e) => e.target.value && wireLegTo(hole, e.target.value)} aria-label={`Wire ${leg.name} to a board pin`} data-testid={`bench-wire-leg-${i}`}>
                        <option value="">Wire to…</option>
                        {pinOptions.map((p) => (
                          <option key={p} value={`pin:${p}`}>
                            {p === '5V' || p === 'GND' ? p : `pin ${p}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="bench-actions">
              <button type="button" className="btn small" onClick={rotate} disabled={sim.running} data-keys="R" data-tip="Turn it a quarter turn" data-testid="bench-rotate">
                <RotateCw className="icon sm" />
                Turn
              </button>
              <button type="button" className="btn small" onClick={remove} disabled={sim.running} data-keys="Delete" data-tip="Remove it from the bench" data-testid="bench-delete">
                <Trash2 className="icon sm" />
                Remove
              </button>
            </div>
          </>
        ) : wire ? (
          <>
            <h3>Wire</h3>
            <p className="bench-muted">
              From {wire.from.startsWith('pin:') ? `pin ${wire.from.slice(4)}` : wire.from.slice(3)} to {wire.to.startsWith('pin:') ? `pin ${wire.to.slice(4)}` : wire.to.slice(3)}
            </p>
            <div className="bench-swatches" role="radiogroup" aria-label="Wire colour">
              {WIRE_COLOURS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={c === wire.colour} aria-label={WIRE_NAMES[c]} className={`swatch ${c === wire.colour ? 'on' : ''}`} style={{ background: c }} onClick={() => update({ ...layout, wires: layout.wires.map((w) => (w.id === wire.id ? { ...w, colour: c } : w)) })} />
              ))}
            </div>
            <div className="bench-actions">
              <button type="button" className="btn small" onClick={remove} disabled={sim.running} data-testid="bench-delete">
                <Trash2 className="icon sm" />
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>On the bench</h3>
            {layout.parts.length === 0 ? (
              <p className="bench-muted">Add parts from the left, or press “Build from blocks”. Drag to move, and draw wires with the Wire tool.</p>
            ) : (
              <ul className="bench-list" data-testid="bench-list">
                {layout.parts.map((p) => (
                  <li key={p.id} data-testid={`bench-item-${p.kind}`} data-level={(partState(p.id)?.level ?? 0).toFixed(2)}>
                    <button type="button" className="link" onClick={() => setSelected(p.id)}>
                      {labelOf(p.id)}
                    </button>
                    <span className="bench-muted">{reading(partState(p.id), p.kind)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="bench-muted">
              {layout.wires.length} wire{layout.wires.length === 1 ? '' : 's'}
            </p>
          </>
        )}
        {benchProblems.map((p) => (
          <p key={p.message} className={`sim-problem ${p.severity}`} data-testid="bench-problem">
            <TriangleAlert className="icon sm" aria-hidden="true" />
            <span>{p.message}</span>
          </p>
        ))}
      </aside>

      {instrumentsOpen && (
        <Instruments
          board={board}
          layout={layout}
          sim={sim}
          slot={probeSlot}
          onSlot={setProbeSlot}
          registerProbe={registerProbe}
          onProbes={showProbes}
          onClose={() => {
            setInstrumentsOpen(false);
            setProbeSlot(null);
          }}
        />
      )}
      <p className="bench-hint" role="status" data-testid="bench-hint">
        {notice ??
          hover ??
          (sim.running
            ? 'Running. Click a button to press it, or a switch to flip it.'
            : probeSlot
              ? 'Click the point to probe. Drag to look around; Esc cancels.'
              : mode.kind === 'wire'
              ? 'Click a hole or a board pin to start the wire, then click where it ends.'
              : 'Drag with the left button to look around, right button to slide, wheel to zoom.')}
      </p>
    </div>
  );
}

function reading(s: { volts: number; milliamps: number; level: number; input?: number } | undefined, kind: PlaceableKind): string {
  if (!s) return '';
  if (kind === 'led') return s.level > 0.01 ? `on · ${s.milliamps.toFixed(1)} mA` : 'off';
  if (kind === 'buzzer') return s.level > 0 ? 'sounding' : 'silent';
  if (kind === 'button' || kind === 'switch') return (s.input ?? 0) >= 0.5 ? 'closed' : 'open';
  if (kind === 'potentiometer') return `${Math.round((s.input ?? 0.5) * 100)} % · ${s.volts.toFixed(2)} V`;
  return `${s.milliamps.toFixed(2)} mA`;
}

function Readings({ id, sim }: { id: string; sim: Simulation }) {
  const s = sim.state.parts[id];
  if (!s) return null;
  return (
    <div className="sim-meters">
      <div className="sim-meter">
        <span>Voltage across</span>
        <b>{s.volts.toFixed(2)} V</b>
      </div>
      <div className="sim-meter">
        <span>Current</span>
        <b>{s.milliamps.toFixed(2)} mA</b>
      </div>
    </div>
  );
}

function Operate({ part, sim }: { part: PlacedPart; sim: Simulation }) {
  const input = sim.state.parts[part.id]?.input ?? 0;
  if (part.kind === 'button')
    return (
      <button
        type="button"
        className={`btn small ${input >= 0.5 ? 'primary' : ''}`}
        onPointerDown={() => sim.sim.setInput(part.id, 1)}
        onPointerUp={() => sim.sim.setInput(part.id, 0)}
        onPointerLeave={() => sim.sim.setInput(part.id, 0)}
        data-testid="bench-press"
      >
        Hold to press
      </button>
    );
  if (part.kind === 'switch')
    return (
      <label className="check">
        <input type="checkbox" checked={input >= 0.5} onChange={(e) => sim.sim.setInput(part.id, e.target.checked ? 1 : 0)} /> on
      </label>
    );
  if (part.kind === 'potentiometer')
    return <input type="range" min={0} max={100} value={Math.round(input * 100)} onChange={(e) => sim.sim.setInput(part.id, Number(e.target.value) / 100)} aria-label="Knob position" data-testid="bench-knob" />;
  return null;
}
