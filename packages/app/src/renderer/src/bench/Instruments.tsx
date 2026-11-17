import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, Crosshair, Gauge, Pause, Play, Waves, X } from '../ui/icons';
import {
  boardPinOrder,
  legHoles,
  nodeOfPinField,
  PART_KINDS,
  siPrefix,
  waveStats,
  type BoardDefinition,
  type CircuitLayout,
  type Sample,
} from '@tariro-studio/core';
import type { Simulation } from '../sim/useSimulation';
import type { Probe } from './scene';

/** A probe slot waiting for the learner to click a point on the bench. */
export type ProbeSlot = 'red' | 'black' | 'ch1' | 'ch2' | 'part';

interface Props {
  board: BoardDefinition;
  layout: CircuitLayout;
  sim: Simulation;
  /** The slot being placed, if any: the bench is in probe mode while it is set. */
  slot: ProbeSlot | null;
  onSlot(slot: ProbeSlot | null): void;
  /** The bench calls the registered function with each click while a slot is being placed. */
  registerProbe(handler: ((conn: string | undefined, partId: string | undefined) => void) | null): void;
  onProbes(probes: Probe[]): void;
  onClose(): void;
}

type Tab = 'meter' | 'scope' | 'logic';
type MeterFn = 'V' | 'R' | 'A';
const TIMEBASES = [10, 50, 100, 200, 500, 1000, 2000];
const DIVS = 10;
const CH_COLOURS = ['#ffd400', '#2ee6e6'];
const KEEP_MS = 30_000;

/**
 * Virtual instruments for the simulated circuit: a multimeter (volts, ohms, amps), a
 * two-channel oscilloscope and a logic view of the board's pins. Probes are placed by clicking
 * points on the bench, or chosen from the lists.
 */
export function Instruments({ board, layout, sim, slot, onSlot, registerProbe, onProbes, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('meter');
  const [fn, setFn] = useState<MeterFn>('V');
  const [red, setRed] = useState<string>('');
  const [black, setBlack] = useState<string>('pin:GND');
  const [part, setPart] = useState<string>('');
  const [channels, setChannels] = useState<[string, string]>(['', '']);
  const [timebase, setTimebase] = useState(500);
  const [hold, setHold] = useState(false);

  // ───────── probe points ─────────
  const points = useMemo(() => {
    const out: Array<{ id: string; label: string }> = boardPinOrder(board).map((p) => ({ id: `pin:${p}`, label: p === '5V' || p === 'GND' ? `Board ${p}` : `Board pin ${p}` }));
    const counts: Record<string, number> = {};
    for (const p of layout.parts) {
      counts[p.kind] = (counts[p.kind] ?? 0) + 1;
      PART_KINDS[p.kind].legs.forEach((leg, i) => {
        const hole = legHoles(p)?.[i];
        if (hole) out.push({ id: hole, label: `${PART_KINDS[p.kind].name} ${counts[p.kind]}: ${leg.name} (${hole.slice(3)})` });
      });
    }
    return out;
  }, [board, layout]);
  const label = (id: string) => points.find((p) => p.id === id)?.label ?? (id.startsWith('bb:') ? `Hole ${id.slice(3)}` : id);

  /** The simulator node a probe point touches. */
  const nodeOf = (conn: string): string | undefined => {
    if (!conn) return undefined;
    if (conn === 'pin:5V') return '5V';
    if (conn === 'pin:GND') return 'GND';
    if (conn.startsWith('pin:')) return nodeOfPinField(board, conn.slice(4));
    return sim.nodeAt(conn);
  };
  const volts = (conn: string) => {
    const node = nodeOf(conn);
    return node === undefined ? undefined : (sim.state.nodes[node] ?? 0);
  };

  // Clicks on the bench fill the slot being placed; a red probe then hands over to the black one.
  useLayoutEffect(() => {
    registerProbe((conn, partId) => {
      if (slot === 'part') {
        if (partId) {
          setPart(partId);
          onSlot(null);
        }
        return;
      }
      if (!conn) return;
      if (slot === 'red') {
        setRed(conn);
        onSlot('black');
      } else if (slot === 'black') {
        setBlack(conn);
        onSlot(null);
      } else if (slot === 'ch1') {
        setChannels(([, b]) => [conn, b]);
        onSlot(null);
      } else if (slot === 'ch2') {
        setChannels(([a]) => [a, conn]);
        onSlot(null);
      }
    });
    return () => registerProbe(null);
  });

  // Show the probes that are in use on the bench.
  const probeKey = tab === 'meter' ? (fn === 'A' ? '' : `${red}|${black}`) : tab === 'scope' ? channels.join('|') : '';
  useEffect(() => {
    const out: Probe[] = [];
    if (tab === 'meter' && fn !== 'A') {
      if (red) out.push({ conn: red, colour: 0xe53935 });
      if (black) out.push({ conn: black, colour: 0x222222 });
    } else if (tab === 'scope') {
      channels.forEach((c, i) => c && out.push({ conn: c, colour: i === 0 ? 0xffd400 : 0x2ee6e6 }));
    }
    onProbes(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- probeKey stands for the probes
  }, [probeKey, tab]);
  useEffect(() => () => onProbes([]), [onProbes]);

  // ───────── recording for the scope and the logic view ─────────
  // The timer records into `rec` and publishes a snapshot; rendering only reads the snapshot.
  const rec = useRef<{ start: number; series: Map<string, Sample[]> } | null>(null);
  const [frame, setFrame] = useState<{ now: number; series: Record<string, Sample[]> }>({ now: 0, series: {} });
  const holdRef = useRef(hold);
  const readRef = useRef<() => Array<[string, number]>>(() => []);
  useLayoutEffect(() => {
    holdRef.current = hold;
    readRef.current = () => {
      const out: Array<[string, number]> = [];
      channels.forEach((c, i) => {
        const v = volts(c);
        if (c && v !== undefined) out.push([`ch${i + 1}`, v]);
      });
      for (const [node, pin] of Object.entries(sim.state.pins)) out.push([`pin:${node}`, pin.volts]);
      return out;
    };
  });
  useEffect(() => {
    if (tab === 'meter') return;
    rec.current ??= { start: performance.now(), series: new Map() };
    const r = rec.current;
    const id = setInterval(() => {
      if (holdRef.current) return;
      const t = performance.now() - r.start;
      for (const [key, v] of readRef.current()) {
        const arr = r.series.get(key) ?? [];
        // Store changes only; a value holds until the next sample.
        if (arr.length === 0 || Math.abs(arr[arr.length - 1]!.v - v) > 1e-4) arr.push({ t, v });
        while (arr.length > 2 && arr[1]!.t < t - KEEP_MS) arr.shift();
        r.series.set(key, arr);
      }
      setFrame({ now: t, series: Object.fromEntries([...r.series].map(([k, v]) => [k, [...v]])) });
    }, 20);
    return () => clearInterval(id);
  }, [tab]);
  // A new probe point starts a fresh trace.
  useEffect(() => {
    rec.current?.series.delete('ch1');
  }, [channels[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    rec.current?.series.delete('ch2');
  }, [channels[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = frame.now;
  const windowMs = timebase * DIVS;
  const from = now - windowMs;
  const seriesOf = (key: string) => frame.series[key] ?? [];

  // ───────── multimeter reading ─────────
  let reading = '—';
  let note: string;
  if (fn === 'V') {
    const a = red ? volts(red) : undefined;
    const b = black ? volts(black) : undefined;
    if (!red || !black) note = 'Place the red and black probes.';
    else {
      reading = siPrefix((a ?? 0) - (b ?? 0), 'V');
      if (a === undefined || b === undefined) note = 'A probe touches a point with nothing connected, which reads 0 V.';
      else note = 'Red minus black, measured while the circuit runs.';
    }
  } else if (fn === 'R') {
    const a = nodeOf(red);
    const b = nodeOf(black);
    if (!red || !black) note = 'Place the red and black probes.';
    else if (a === undefined || b === undefined) {
      reading = 'OL';
      note = 'A probe touches a point with nothing connected.';
    } else {
      const ohms = sim.sim.measureResistance(a, b);
      reading = Number.isFinite(ohms) ? siPrefix(ohms, 'Ω') : 'OL';
      note = 'Measured with the power off, as a real meter must be. OL means no path.';
    }
  } else {
    const s = part ? sim.state.parts[part] : undefined;
    if (!part) note = 'Click a part on the bench (or choose it) to measure the current through it.';
    else if (!s) note = 'That part is no longer on the bench.';
    else {
      reading = siPrefix(s.milliamps / 1000, 'A');
      note = 'A real ammeter is wired in series with the part; here you just pick the part.';
    }
  }

  const pointSelect = (value: string, set: (v: string) => void, which: ProbeSlot, name: string) => (
    <div className="inst-probe">
      <span className={`inst-dot ${which}`} aria-hidden="true" />
      <select value={value} onChange={(e) => set(e.target.value)} aria-label={`${name} probe point`} data-testid={`inst-${which}`}>
        <option value="">Choose a point…</option>
        {points.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        {value && !points.some((p) => p.id === value) && <option value={value}>{label(value)}</option>}
      </select>
      <button
        type="button"
        className={`btn small icon-only ${slot === which ? 'primary' : 'ghost'}`}
        onClick={() => onSlot(slot === which ? null : which)}
        aria-pressed={slot === which}
        aria-label={`Place the ${name} probe on the bench`}
        data-tip={`Click a hole or pin on the bench for the ${name} probe`}
        data-testid={`inst-place-${which}`}
      >
        <Crosshair className="icon sm" />
      </button>
    </div>
  );

  return (
    <section className="instruments" aria-label="Instruments" data-testid="instruments">
      <header className="inst-head">
        <div className="segmented small" role="tablist" aria-label="Instrument">
          {([
            ['meter', Gauge, 'Multimeter'],
            ['scope', Waves, 'Oscilloscope'],
            ['logic', Activity, 'Logic'],
          ] as const).map(([id, Icon, name]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`inst-tab-${id}`}>
              <Icon className="icon sm" aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
        {slot && <span className="inst-placing">Click a {slot === 'part' ? 'part' : 'hole or pin'} on the bench…</span>}
        <button type="button" className="btn small ghost icon-only" onClick={onClose} aria-label="Close the instruments" data-testid="inst-close">
          <X className="icon sm" />
        </button>
      </header>

      {tab === 'meter' && (
        <div className="inst-meter">
          <div className="inst-lcd" data-testid="meter-reading">
            <span>{fn === 'V' ? 'DC V' : fn === 'R' ? 'Ω' : 'DC A'}</span>
            <b>{reading}</b>
          </div>
          <div className="inst-controls">
            <div className="segmented small" role="radiogroup" aria-label="Measure">
              {([
                ['V', 'Volts'],
                ['R', 'Ohms'],
                ['A', 'Amps'],
              ] as const).map(([id, name]) => (
                <button key={id} type="button" role="radio" aria-checked={fn === id} className={fn === id ? 'on' : ''} onClick={() => setFn(id)} data-testid={`meter-${id}`}>
                  {name}
                </button>
              ))}
            </div>
            {fn === 'A' ? (
              <div className="inst-probe">
                <select value={part} onChange={(e) => setPart(e.target.value)} aria-label="Part to measure" data-testid="inst-part">
                  <option value="">Choose a part…</option>
                  {sim.sim.circuit.parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button type="button" className={`btn small icon-only ${slot === 'part' ? 'primary' : 'ghost'}`} onClick={() => onSlot(slot === 'part' ? null : 'part')} aria-label="Pick the part on the bench" data-testid="inst-place-part">
                  <Crosshair className="icon sm" />
                </button>
              </div>
            ) : (
              <>
                {pointSelect(red, setRed, 'red', 'red')}
                {pointSelect(black, setBlack, 'black', 'black')}
              </>
            )}
            <p className="bench-muted" data-testid="meter-note">
              {note}
            </p>
          </div>
        </div>
      )}

      {tab === 'scope' && (
        <div className="inst-scope">
          <Trace series={[seriesOf('ch1'), seriesOf('ch2')]} colours={CH_COLOURS} from={from} to={now} label="Oscilloscope trace" />
          <div className="inst-controls">
            {pointSelect(channels[0], (v) => setChannels(([, b]) => [v, b]), 'ch1', 'channel 1')}
            {pointSelect(channels[1], (v) => setChannels(([a]) => [a, v]), 'ch2', 'channel 2')}
            <div className="inst-row">
              <label className="bench-field inline">
                Time
                <select value={timebase} onChange={(e) => setTimebase(Number(e.target.value))} data-testid="scope-timebase">
                  {TIMEBASES.map((t) => (
                    <option key={t} value={t}>
                      {t >= 1000 ? `${t / 1000} s` : `${t} ms`}/div
                    </option>
                  ))}
                </select>
              </label>
              <span className="bench-muted">1 V/div</span>
              <button type="button" className="btn small" onClick={() => setHold((h) => !h)} aria-pressed={hold} data-testid="scope-hold">
                {hold ? <Play className="icon sm" /> : <Pause className="icon sm" />}
                {hold ? 'Run' : 'Hold'}
              </button>
            </div>
            {[0, 1].map((i) => {
              const st = channels[i] ? waveStats(seriesOf(`ch${i + 1}`), Math.max(from, 0), now) : undefined;
              return st ? (
                <p key={i} className="inst-stats" style={{ borderColor: CH_COLOURS[i] }} data-testid={`scope-stats-${i + 1}`}>
                  CH{i + 1}: max {siPrefix(st.max, 'V')} · min {siPrefix(st.min, 'V')} · avg {siPrefix(st.mean, 'V')}
                  {st.frequency !== undefined ? ` · ${st.frequency < 1000 ? `${+st.frequency.toPrecision(3)} Hz` : siPrefix(st.frequency, 'Hz')} · duty ${Math.round((st.duty ?? 0) * 100)} %` : ''}
                </p>
              ) : null;
            })}
            <p className="bench-muted">PWM is simulated as its average voltage, so it shows as a steady level. A real scope shows the pulses.</p>
          </div>
        </div>
      )}

      {tab === 'logic' && (
        <div className="inst-logic" data-testid="logic-view">
          {Object.keys(sim.state.pins).length === 0 ? (
            <p className="bench-muted">Run the program: every pin it uses appears here as a HIGH/LOW timeline.</p>
          ) : (
            Object.keys(sim.state.pins).map((node) => {
              const series = seriesOf(`pin:${node}`);
              const high = (sim.state.pins[node]?.volts ?? 0) > 2.5;
              return (
                <div key={node} className="logic-row" data-testid={`logic-${node}`} data-high={high}>
                  <span>Pin {node === '5V' || node === 'GND' ? node : node.replace(/^D/, '')}</span>
                  <Trace series={[series.map((s) => ({ t: s.t, v: s.v > 2.5 ? 5 : 0 }))]} colours={['#3fb950']} from={from} to={now} compact label={`Pin ${node} logic level`} />
                  <b>{high ? 'HIGH' : 'LOW'}</b>
                </div>
              );
            })
          )}
          <label className="bench-field inline">
            Time
            <select value={timebase} onChange={(e) => setTimebase(Number(e.target.value))}>
              {TIMEBASES.map((t) => (
                <option key={t} value={t}>
                  {t >= 1000 ? `${t / 1000} s` : `${t} ms`}/div
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}

/** A scope-style plot: 0–5 V up the side, time across, newest on the right. */
function Trace({ series, colours, from, to, compact = false, label }: { series: Sample[][]; colours: string[]; from: number; to: number; compact?: boolean; label: string }) {
  const W = 500;
  const H = compact ? 28 : 150;
  const vmax = compact ? 5.5 : 6;
  const x = (t: number) => ((t - from) / (to - from)) * W;
  const y = (v: number) => H - (Math.min(Math.max(v, -0.2), vmax) / vmax) * H;
  return (
    <svg className={`inst-trace ${compact ? 'compact' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {!compact &&
        Array.from({ length: DIVS + 1 }, (_, i) => <line key={`v${i}`} x1={(i * W) / DIVS} x2={(i * W) / DIVS} y1={0} y2={H} className="grid" />)}
      {!compact && Array.from({ length: vmax + 1 }, (_, i) => <line key={`h${i}`} x1={0} x2={W} y1={y(i)} y2={y(i)} className="grid" />)}
      {series.map((s, i) => {
        if (s.length === 0) return null;
        // Step trace: each value holds until the next sample.
        const startIdx = Math.max(0, s.findIndex((p) => p.t > from) - 1);
        const pts = s.slice(startIdx === -1 ? s.length - 1 : startIdx);
        let d = '';
        pts.forEach((p, k) => {
          const px = Math.max(x(p.t), 0);
          d += k === 0 ? `M${px.toFixed(1)},${y(p.v).toFixed(1)}` : `H${px.toFixed(1)}V${y(p.v).toFixed(1)}`;
        });
        d += `H${W}`;
        return <path key={i} d={d} fill="none" stroke={colours[i]} strokeWidth={compact ? 1.6 : 2} vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}
