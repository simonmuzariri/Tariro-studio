import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import {
  checkLive,
  DEFAULT_DRONE_LIMITS,
  DRONE_LIMIT_RANGES,
  DroneSim,
  FlightRecorder,
  LiveRun,
  MAX_SAVED_FLIGHTS,
  recordingLink,
  sampleAt,
  summarizeFlight,
  type BoardDefinition,
  type DroneLimits,
  type DroneLink,
  type DroneState,
  type FlightLog,
  type PathPoint,
  type ExperienceLevel,
  type LiveBoard,
  type WorkspaceJson,
} from '@tariro-studio/core';
import { buildToolbox, DRONE_STARTER, droneToolbox, flightToWorkspace } from '@tariro-studio/extensions';
import { blocklyTheme } from '../blockly/theme';
import { registry } from '../registry';
import type { ThemeName } from '../ui/theme';
import { Octagon, Play, RotateCcw, Square, TriangleAlert } from '../ui/icons';
import { DroneScene } from './droneScene';
import { TelloLink } from './telloLink';

type Target = 'sim' | 'tello';
/** The real-drone checklist is confirmed once per app session. */
let checklistDone = false;
const storedTarget = (): Target => {
  try {
    return localStorage.getItem('tariro.drone.target') === 'tello' ? 'tello' : 'sim';
  } catch {
    return 'sim';
  }
};

export interface DroneProject {
  workspace: Record<string, unknown>;
  limits?: DroneLimits | undefined;
  /** Saved flights (6c), to replay or turn into blocks. */
  flights?: FlightLog[] | undefined;
}

/** A recorded flight being played back in the view. */
interface Replay {
  log: FlightLog;
  t: number;
  playing: boolean;
  speed: number;
}

/** The drone as a replayed flight has it at the replay's time. */
function replayed(rp: Replay, base: DroneState): DroneState {
  const at = sampleAt(rp.log, rp.t);
  return at ? { ...base, x: at.x, y: at.y, z: at.z, heading: at.heading, pitch: at.pitch, roll: at.roll, battery: at.battery, flying: at.z > 1, phase: at.z > 1 ? 'moving' : 'ground', flightTime: rp.t } : base;
}

const STEPS = [20, 50, 100];
const TURNS = [45, 90];

interface Props {
  drone: DroneProject | undefined;
  onChange(drone: DroneProject): void;
  theme: ThemeName;
  level: ExperienceLevel;
  /** The project's board (drone programs do not use it; the interpreter needs one). */
  board: BoardDefinition;
}

/** Drone programs drive no board pins: anything that tries is a mistake checkLive already refuses. */
const NO_BOARD: LiveBoard = {
  digitalWrite: async () => {},
  analogWrite: async () => {},
  servoWrite: async () => {},
  digitalRead: async () => false,
  analogRead: async () => 0,
  analogPin: async () => undefined,
};

const PHASES: Record<DroneState['phase'], string> = {
  ground: 'On the ground',
  takeoff: 'Taking off',
  hover: 'Hovering',
  moving: 'Flying',
  turning: 'Turning',
  flipping: 'Flipping',
  landing: 'Landing',
  falling: 'Falling (motors off)',
};

/**
 * Drone Studio: program a drone with blocks and fly it in the simulator, with the learner's safety
 * limits shown around it. Esc lands the drone (the emergency stop, which cuts the motors, has its own button).
 */
export default function DroneStudio({ drone, onChange, theme, level, board }: Props) {
  const limits = drone?.limits ?? DEFAULT_DRONE_LIMITS;
  const blocksHost = useRef<HTMLDivElement>(null);
  const viewHost = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const scene = useRef<DroneScene | null>(null);
  const sim = useRef(new DroneSim(limits));
  const run = useRef<LiveRun | null>(null);
  const [flying, setFlying] = useState(false); // a program is running
  const [state, setState] = useState<DroneState>(() => sim.current.state());
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [follow, setFollow] = useState(false);
  // Which drone the program flies: the simulator, or a real Tello over Wi-Fi.
  const [target, setTargetState] = useState<Target>(storedTarget);
  const targetRef = useRef<Target>(target);
  const tello = useRef<TelloLink | null>(null);
  const [linked, setLinked] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [checklist, setChecklist] = useState(false);
  const setTarget = (t: Target) => {
    setTargetState(t);
    targetRef.current = t;
    try {
      localStorage.setItem('tariro.drone.target', t);
    } catch {
      /* remembered until the app closes */
    }
  };
  const link = () => (targetRef.current === 'tello' && tello.current ? tello.current : sim.current);
  const latest = useRef({ drone, onChange, limits });
  useLayoutEffect(() => {
    latest.current = { drone, onChange, limits };
  });
  /** Save a change to the drone part of the project, keeping the rest of it. */
  const save = useCallback((patch: Partial<DroneProject>) => {
    const { drone: d, onChange: emit } = latest.current;
    const w = ws.current;
    const workspace = (w ? Blockly.serialization.workspaces.save(w) : (d?.workspace ?? DRONE_STARTER)) as Record<string, unknown>;
    const next: DroneProject = { workspace, ...(d?.limits ? { limits: d.limits } : {}), ...(d?.flights?.length ? { flights: d.flights } : {}), ...patch };
    if (!next.flights?.length) delete next.flights;
    emit(next);
  }, []);

  // ── recording (6c): every flight, flown by a program or by hand, on either drone
  const recorder = useRef<FlightRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [lastFlight, setLastFlight] = useState<FlightLog | null>(null);
  const [flightsOpen, setFlightsOpen] = useState(false);
  const replay = useRef<Replay | null>(null);
  const [replayUi, setReplayUi] = useState<Replay | null>(null);
  const [pilotOpen, setPilotOpen] = useState(false);
  const [pilotBusy, setPilotBusy] = useState(false);
  const pilotBusyRef = useRef(false);
  const [step, setStep] = useState(50);
  const [turnStep, setTurnStep] = useState(90);
  /** Start recording if the drone is on the ground (a new flight); a flight in the air goes on in the same log. */
  const startRecording = () => {
    if (link().state().flying && recorder.current) return;
    recorder.current = new FlightRecorder(targetRef.current, () => performance.now() / 1000);
    setRecording(true);
  };
  /** What a program or the pilot pad flies: the chosen drone, with every command recorded. */
  const recorded = (): DroneLink => recordingLink(link(), () => recorder.current ?? undefined);
  const stopReplay = () => {
    replay.current = null;
    setReplayUi(null);
  };

  // ── blocks
  useEffect(() => {
    if (!blocksHost.current) return;
    const w = Blockly.inject(blocksHost.current, {
      toolbox: buildToolbox(droneToolbox(level)) as unknown as Blockly.utils.toolbox.ToolboxDefinition,
      theme: blocklyTheme(theme),
      renderer: 'zelos',
      media: './',
      trashcan: true,
      sounds: true,
      zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 2, minScale: 0.3 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: theme === 'light' ? '#d9dce2' : '#2c3039', snap: false },
    });
    ws.current = w;
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load((latest.current.drone?.workspace ?? DRONE_STARTER) as object, w);
    } finally {
      Blockly.Events.enable();
    }
    w.addChangeListener((e: Blockly.Events.Abstract) => {
      // Keeps the limits and saved flights: only the program changed.
      if (!e.isUiEvent) save({});
    });
    const resize = new ResizeObserver(() => Blockly.svgResize(w));
    resize.observe(blocksHost.current);
    return () => {
      resize.disconnect();
      w.dispose();
      ws.current = null;
    };
    // Mounted once per project; theme and level are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => ws.current?.setTheme(blocklyTheme(theme)), [theme]);
  useEffect(() => {
    ws.current?.updateToolbox(buildToolbox(droneToolbox(level)) as unknown as Blockly.utils.toolbox.ToolboxDefinition);
  }, [level]);

  // ── the flight view, and the simulator's clock: it runs every frame (a landing finishes after the program)
  useEffect(() => {
    if (!viewHost.current) return;
    let s: DroneScene;
    try {
      s = new DroneScene(viewHost.current, theme === 'dark' ? 'dark' : 'light');
    } catch (e) {
      queueMicrotask(() => setMessage({ text: `The 3D view could not start on this computer (${e instanceof Error ? e.message : String(e)}).`, bad: true }));
      return;
    }
    scene.current = s;
    s.setLimits(latest.current.limits);
    let shown = 0;
    let notes = 0;
    // The simulator runs on the real clock, in small steps, whether or not the window is being drawn
    // (a hidden window gets few frames): a flight takes the same time either way.
    let clock = performance.now();
    const advance = () => {
      const now = performance.now();
      let left = Math.min(now - clock, 10_000);
      clock = now;
      const elapsed = left;
      while (left > 0) {
        const dtStep = Math.min(left, 50);
        sim.current.step(dtStep);
        left -= dtStep;
      }
      // A replay plays on the same clock.
      const rp = replay.current;
      if (rp?.playing) {
        const end = rp.log.samples.at(-1)?.t ?? 0;
        rp.t = Math.min(end, rp.t + (elapsed / 1000) * rp.speed);
        if (rp.t >= end) rp.playing = false;
      }
    };
    const timer = setInterval(advance, 100);
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const dt = Math.min(now - last, 100);
      last = now;
      advance();
      const d = link();
      let st = d.state();
      let path: readonly PathPoint[] = d.path;
      const rp = replay.current;
      if (rp) {
        // Playing a recorded flight back instead of showing the drone.
        st = replayed(rp, st);
        path = rp.log.samples.filter((p) => p.t <= rp.t);
      } else if (recorder.current) {
        recorder.current.sample(st);
        // Back on the ground with nothing running: the flight is over.
        if (!st.flying && !run.current && !pilotBusyRef.current && !recorder.current.empty) {
          const n = (latest.current.drone?.flights?.length ?? 0) + 1;
          setLastFlight(recorder.current.finish(`flight-${Date.now().toString(36)}`, `Flight ${n} (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`));
          recorder.current = null;
          setRecording(false);
        }
      }
      s.update(st, path, dt / 1000);
      if (now - shown > 100) {
        shown = now;
        setState(st);
      }
      if (d.notes.length > notes) {
        notes = d.notes.length;
        const note = d.notes.at(-1)!;
        // Plain news ("Connected", "Landing") is not a warning; refusals and safety landings are.
        setMessage({ text: note, bad: !/^(Connected|Landing\.|Landing before)/.test(note) });
      } else if (d.notes.length < notes) notes = d.notes.length;
      frame = requestAnimationFrame(tick);
    });
    // For tests: what the view shows (the drone, or a replayed flight), as the learner sees it.
    (window as unknown as { __tariroDrone?: unknown }).__tariroDrone = { state: () => (replay.current ? replayed(replay.current, link().state()) : link().state()), path: () => link().path.length };
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      s.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => scene.current?.setTheme(theme === 'dark' ? 'dark' : 'light'), [theme]);
  useEffect(() => {
    sim.current.setLimits(limits);
    scene.current?.setLimits(limits);
    // The real drone's guard (in the main process) gets the same limits.
    if (linked) void window.studio.drone.setLimits(limits);
  }, [limits, linked]);

  // ── the real drone: its link lives while Drone Studio is open; heartbeats keep the watchdog quiet
  useEffect(() => {
    const t = new TelloLink((s) => setLinked(s.connected));
    tello.current = t;
    return () => {
      t.dispose();
      tello.current = null;
      void window.studio.drone.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!linked) return;
    const beat = setInterval(() => void window.studio.drone.heartbeat(), 500);
    void window.studio.drone.heartbeat();
    return () => clearInterval(beat);
  }, [linked]);

  const connectTello = async () => {
    setConnecting(true);
    setMessage({ text: 'Looking for the drone…', bad: false });
    const r = await window.studio.drone.connect();
    setConnecting(false);
    setLinked(r.ok);
    setMessage({ text: r.ok ? 'Connected to the drone. It flies the program when you press Fly.' : r.message, bad: !r.ok });
    if (r.ok) await window.studio.drone.setLimits(latest.current.limits);
  };
  useEffect(() => {
    if (scene.current) scene.current.follow = follow;
  }, [follow]);

  // ── flying
  const highlight = (id: string | undefined) => {
    const w = ws.current;
    if (!w) return;
    w.highlightBlock(id ?? null);
  };

  const fly = useCallback(async (confirmed = false) => {
    const w = ws.current;
    if (!w || run.current) return;
    const real = targetRef.current === 'tello';
    if (real && !tello.current?.connected) {
      setMessage({ text: 'Connect to the drone first (Connect, above the view).', bad: true });
      return;
    }
    if (real && !checklistDone && !confirmed) {
      setChecklist(true);
      return;
    }
    const workspace = Blockly.serialization.workspaces.save(w) as WorkspaceJson;
    const problems = checkLive(workspace, board, registry, 'drone');
    if (problems.length) {
      setMessage({ text: problems[0]!.message, bad: true });
      if (problems[0]!.blockId) w.getBlockById(problems[0]!.blockId)?.select();
      return;
    }
    // A new simulated flight starts from the pad, unless the drone is still in the air.
    if (!real && !sim.current.state().flying) sim.current.reset();
    stopReplay();
    startRecording();
    setMessage(null);
    const r = new LiveRun(
      workspace,
      board,
      registry,
      { io: NO_BOARD, drone: recorded(), now: () => performance.now(), sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), print: () => {}, onBlock: highlight },
      'drone',
    );
    run.current = r;
    setFlying(true);
    const result = await r.run();
    run.current = null;
    setFlying(false);
    highlight(undefined);
    if (result.outcome === 'error') {
      setMessage({ text: result.message, bad: true });
      if (result.blockId) w.getBlockById(result.blockId)?.select();
    } else if (result.outcome === 'finished') setMessage({ text: link().state().flying ? 'The program finished; the drone is hovering. Land it before you leave.' : 'Flight finished.', bad: false });
    // The recording helpers only read refs, so the callback does not need to change with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const stop = useCallback(() => {
    run.current?.stop();
    if (targetRef.current === 'sim') sim.current.cancel();
    setMessage({ text: link().state().flying ? 'Stopped: the drone is hovering where it was.' : 'Stopped.', bad: false });
     
  }, []);

  const landNow = useCallback(() => {
    run.current?.stop();
    if (targetRef.current === 'tello') void window.studio.drone.landNow();
    else {
      sim.current.cancel();
      if (sim.current.state().flying) void sim.current.land();
    }
    setMessage({ text: 'Landing.', bad: false });
  }, []);

  const emergency = useCallback(() => {
    run.current?.stop();
    void link().emergency();
     
  }, []);

  const reset = useCallback(() => {
    run.current?.stop();
    sim.current.reset();
    setMessage(null);
  }, []);

  // Esc lands the drone (a safe stop); the emergency stop is a deliberate button press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (link().state().flying || run.current) landNow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [landNow]);

  const setLimit = (key: keyof DroneLimits, value: number) => {
    const [lo, hi] = DRONE_LIMIT_RANGES[key];
    if (!Number.isFinite(value)) return;
    save({ limits: { ...limits, [key]: Math.min(Math.max(Math.round(value), lo), hi) } });
  };

  // ── the pilot pad: one command per press, through the same limits (and on a Tello, its guard)
  const pilot = async (go: (d: DroneLink) => Promise<void>, takeoff = false) => {
    if (pilotBusyRef.current || run.current) return;
    if (targetRef.current === 'tello' && !tello.current?.connected) return setMessage({ text: 'Connect to the drone first.', bad: true });
    if (targetRef.current === 'tello' && !checklistDone) return setChecklist(true);
    if (takeoff) {
      if (targetRef.current === 'sim' && !sim.current.state().flying) sim.current.reset();
      stopReplay();
      startRecording();
    }
    pilotBusyRef.current = true;
    setPilotBusy(true);
    try {
      await go(recorded());
      setMessage(null);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      pilotBusyRef.current = false;
      setPilotBusy(false);
    }
  };

  // ── flights: save, replay, turn into blocks, delete
  const saved = drone?.flights ?? [];
  const saveFlight = (log: FlightLog) => {
    if (saved.length >= MAX_SAVED_FLIGHTS) return setMessage({ text: `A project keeps ${MAX_SAVED_FLIGHTS} flights. Delete one to save this.`, bad: true });
    save({ flights: [...saved, log] });
    setLastFlight(null);
  };
  const startReplay = (log: FlightLog) => {
    // A replay takes over the view: only while the drone itself is on the ground.
    if (link().state().flying || run.current) return setMessage({ text: 'Land the drone before replaying a flight.', bad: true });
    replay.current = { log, t: 0, playing: true, speed: 1 };
    setReplayUi({ ...replay.current });
    setFlightsOpen(false);
  };
  const toBlocks = (log: FlightLog) => {
    const w = ws.current;
    if (!w) return;
    if (!window.confirm(`Replace the program with the commands of "${log.name}"? (Ctrl+Z brings the old program back.)`)) return;
    // One undoable change: the old program can come back with Ctrl+Z.
    Blockly.Events.setGroup(true);
    try {
      w.clear();
      Blockly.serialization.workspaces.load(flightToWorkspace(log) as object, w, { recordUndo: true });
    } finally {
      Blockly.Events.setGroup(false);
    }
    save({});
    setFlightsOpen(false);
    setMessage({ text: `"${log.name}" is now a program: change it, then press Fly to fly it again.`, bad: false });
  };
  // Keep the replay controls in step with playback.
  useEffect(() => {
    if (!replayUi) return;
    const t = setInterval(() => replay.current && setReplayUi({ ...replay.current }), 100);
    return () => clearInterval(t);
  }, [replayUi]);
  const pilotOff = pilotBusy || flying || !state.flying || !!replayUi;

  const distance = Math.hypot(state.x, state.y);
  return (
    <div className="drone-studio" data-testid="drone-studio">
      <div className="drone-blocks" ref={blocksHost} />
      <section className="drone-side">
        <div className="drone-bar drone-target">
          <div className="segmented" role="tablist" aria-label="Which drone">
            <button type="button" role="tab" aria-selected={target === 'sim'} className={target === 'sim' ? 'on' : ''} onClick={() => setTarget('sim')} disabled={flying || state.flying} data-testid="drone-target-sim">
              Simulator
            </button>
            <button type="button" role="tab" aria-selected={target === 'tello'} className={target === 'tello' ? 'on' : ''} onClick={() => setTarget('tello')} disabled={flying || state.flying} data-tip="A DJI Tello over Wi-Fi" data-testid="drone-target-tello">
              Tello (Wi-Fi)
            </button>
          </div>
          {target === 'tello' &&
            (linked ? (
              <>
                <span className="drone-link on" data-testid="drone-link">
                  Connected · {Math.round(state.battery)} %
                </span>
                <button type="button" className="btn small ghost" onClick={() => void window.studio.drone.disconnect().then(() => setLinked(false))} disabled={flying || state.flying} data-testid="drone-disconnect">
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <span className="drone-link">Join the drone's Wi-Fi (TELLO-…), then connect.</span>
                <button type="button" className="btn small" onClick={() => void connectTello()} disabled={connecting} data-testid="drone-connect">
                  {connecting ? 'Connecting…' : 'Connect'}
                </button>
              </>
            ))}
        </div>
        <div className="drone-bar">
          {flying ? (
            <button type="button" className="btn small primary" onClick={stop} data-testid="drone-stop">
              <Square className="icon sm" fill="currentColor" />
              Stop
            </button>
          ) : (
            <button type="button" className="btn small primary" onClick={() => void fly()} disabled={pilotBusy} data-tip="Run the program and fly the drone in the simulator" data-testid="drone-fly">
              <Play className="icon sm" fill="currentColor" />
              Fly
            </button>
          )}
          <button type="button" className="btn small" onClick={landNow} disabled={!state.flying || !!replayUi} data-keys="Esc" data-tip="Stop the program and land where the drone is" data-testid="drone-land">
            Land now
          </button>
          <button type="button" className="btn small danger" onClick={emergency} disabled={!state.flying || !!replayUi} data-tip="Cut the motors at once: the drone falls. Only to prevent harm." data-testid="drone-emergency">
            <Octagon className="icon sm" />
            Emergency stop
          </button>
          <span className="tb-sep" />
          <button type="button" className="btn small ghost" onClick={reset} disabled={flying || target === 'tello'} data-tip="Put the drone back on the pad with a fresh flight path" data-testid="drone-reset">
            <RotateCcw className="icon sm" />
            Reset
          </button>
          <label className="check drone-follow">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} data-testid="drone-follow" />
            Follow
          </label>
          <button type="button" className="btn small ghost" onClick={() => scene.current?.resetView()} data-tip="Back to the starting view">
            View
          </button>
        </div>
        <div className="drone-bar drone-tools">
          <button type="button" className="btn small ghost" aria-pressed={pilotOpen} onClick={() => setPilotOpen(!pilotOpen)} data-tip="Fly by hand, one move per press (it is recorded)" data-testid="drone-pilot-toggle">
            Pilot pad
          </button>
          <button type="button" className="btn small ghost" aria-pressed={flightsOpen} onClick={() => setFlightsOpen(!flightsOpen)} data-tip="Recorded flights: replay them or turn them into blocks" data-testid="drone-flights-toggle">
            Flights{saved.length ? ` (${saved.length})` : ''}
            {lastFlight && <span className="drone-new" aria-label="a new flight to save" />}
          </button>
          {recording && !replayUi && (
            <span className="drone-rec" data-testid="drone-recording">
              ● Recording
            </span>
          )}
        </div>
        <div className="drone-view-wrap">
          <div className="drone-view" ref={viewHost} />
          {pilotOpen && (
            <div className="drone-pilot" data-testid="drone-pilot">
              <div className="drone-pilot-row">
                <button type="button" className="btn small" disabled={pilotBusy || flying || state.flying || !!replayUi} onClick={() => void pilot((d) => d.takeoff(), true)} data-testid="pilot-takeoff">
                  Take off
                </button>
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.land())} data-testid="pilot-land">
                  Land
                </button>
              </div>
              <div className="drone-pilot-grid">
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.turn('left', turnStep))} aria-label="Turn left" data-testid="pilot-ccw">
                  ↺
                </button>
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.move('forward', step))} aria-label="Forward" data-testid="pilot-forward">
                  ▲
                </button>
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.turn('right', turnStep))} aria-label="Turn right" data-testid="pilot-cw">
                  ↻
                </button>
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.move('left', step))} aria-label="Left" data-testid="pilot-left">
                  ◀
                </button>
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.move('back', step))} aria-label="Back" data-testid="pilot-back">
                  ▼
                </button>
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.move('right', step))} aria-label="Right" data-testid="pilot-right">
                  ▶
                </button>
              </div>
              <div className="drone-pilot-row">
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.move('up', step))} data-testid="pilot-up">
                  Up
                </button>
                <button type="button" className="btn small" disabled={pilotOff} onClick={() => void pilot((d) => d.move('down', step))} data-testid="pilot-down">
                  Down
                </button>
              </div>
              <div className="drone-pilot-row">
                <select value={step} onChange={(e) => setStep(Number(e.target.value))} aria-label="Move step" data-testid="pilot-step">
                  {STEPS.map((v) => (
                    <option key={v} value={v}>
                      {v} cm
                    </option>
                  ))}
                </select>
                <select value={turnStep} onChange={(e) => setTurnStep(Number(e.target.value))} aria-label="Turn step">
                  {TURNS.map((v) => (
                    <option key={v} value={v}>
                      {v}°
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {flightsOpen && (
            <div className="drone-flights" data-testid="drone-flights">
              <h3>Flights</h3>
              {!lastFlight && !saved.length && <p className="drone-muted">Every flight is recorded. Fly, then save it here to replay it or turn it into blocks.</p>}
              {lastFlight && <FlightRow log={lastFlight} fresh onSave={() => saveFlight(lastFlight)} onReplay={() => startReplay(lastFlight)} onBlocks={() => toBlocks(lastFlight)} onDelete={() => setLastFlight(null)} />}
              {saved.map((f) => (
                <FlightRow key={f.id} log={f} onReplay={() => startReplay(f)} onBlocks={() => toBlocks(f)} onDelete={() => save({ flights: saved.filter((x) => x.id !== f.id) })} />
              ))}
            </div>
          )}
          {replayUi && (
            <div className="drone-replay" data-testid="drone-replay">
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  const r = replay.current!;
                  if (r.t >= (r.log.samples.at(-1)?.t ?? 0)) r.t = 0;
                  r.playing = !r.playing;
                  setReplayUi({ ...r });
                }}
                data-testid="drone-replay-play"
              >
                {replayUi.playing ? 'Pause' : 'Play'}
              </button>
              <input
                type="range"
                min={0}
                max={replayUi.log.samples.at(-1)?.t ?? 0}
                step={0.1}
                value={replayUi.t}
                onChange={(e) => {
                  const r = replay.current!;
                  r.t = e.target.valueAsNumber;
                  r.playing = false;
                  setReplayUi({ ...r });
                }}
                aria-label="Replay time"
                data-testid="drone-replay-time"
              />
              <span className="drone-replay-clock" data-testid="drone-replay-clock">
                {replayUi.t.toFixed(1)} / {(replayUi.log.samples.at(-1)?.t ?? 0).toFixed(1)} s
              </span>
              <select
                value={replayUi.speed}
                onChange={(e) => {
                  const r = replay.current!;
                  r.speed = Number(e.target.value);
                  setReplayUi({ ...r });
                }}
                aria-label="Replay speed"
              >
                {[1, 2, 4].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
              <span className="drone-replay-name">{replayUi.log.name}</span>
              <button type="button" className="btn small ghost" onClick={stopReplay} data-testid="drone-replay-close">
                Close
              </button>
            </div>
          )}
        </div>
        {message && (
          <p className={`drone-message ${message.bad ? 'bad' : ''}`} role="status" data-testid="drone-message">
            {message.bad && <TriangleAlert className="icon sm" aria-hidden="true" />}
            {message.text}
          </p>
        )}
        <div className="drone-panel">
          <dl className="drone-telemetry" data-testid="drone-telemetry">
            <div>
              <dt>Status</dt>
              <dd data-testid="drone-phase">{PHASES[state.phase]}</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd data-testid="drone-height">{Math.round(state.z)} cm</dd>
            </div>
            <div>
              <dt>Battery</dt>
              <dd>
                <span className={`drone-battery${state.battery < 20 ? ' low' : ''}`}>
                  <i style={{ width: `${state.battery}%` }} />
                </span>
                {Math.round(state.battery)} %
              </dd>
            </div>
            <div>
              <dt>Heading</dt>
              <dd>{Math.round(state.heading)}°</dd>
            </div>
            <div>
              <dt>From start</dt>
              <dd>{Math.round(distance)} cm</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{state.speed} cm/s</dd>
            </div>
            <div>
              <dt>Flight time</dt>
              <dd>{state.flightTime.toFixed(1)} s</dd>
            </div>
          </dl>
          <fieldset className="drone-limits" disabled={flying}>
            <legend>Safety limits</legend>
            <label>
              Height limit
              <input type="number" min={DRONE_LIMIT_RANGES.maxHeight[0]} max={DRONE_LIMIT_RANGES.maxHeight[1]} step={10} value={limits.maxHeight} onChange={(e) => setLimit('maxHeight', e.target.valueAsNumber)} data-testid="drone-limit-height" />
              cm
            </label>
            <label>
              Fence
              <input type="number" min={DRONE_LIMIT_RANGES.fenceRadius[0]} max={DRONE_LIMIT_RANGES.fenceRadius[1]} step={50} value={limits.fenceRadius} onChange={(e) => setLimit('fenceRadius', e.target.valueAsNumber)} data-testid="drone-limit-fence" />
              cm from the pad
            </label>
          </fieldset>
        </div>
      </section>
      {checklist && <Checklist onCancel={() => setChecklist(false)} onConfirm={() => {
        checklistDone = true;
        setChecklist(false);
        void fly(true);
      }} />}
    </div>
  );
}

const CHECKS = [
  'There are 2 metres of clear space around and above the drone, and no one is close to it.',
  'The propeller guards are on and the propellers are not damaged.',
  'I can see the drone the whole time it flies.',
  'I know that Esc (or Land now) lands it, and Emergency stop cuts the motors.',
];

/** Before the first real flight of a session: the learner confirms the drone is safe to fly. */
function Checklist({ onCancel, onConfirm }: { onCancel(): void; onConfirm(): void }) {
  const [ticked, setTicked] = useState<boolean[]>(CHECKS.map(() => false));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <section className="modal drone-checklist" role="dialog" aria-label="Before you fly" data-testid="drone-checklist">
        <h2>Before you fly a real drone</h2>
        <p>A drone's propellers can hurt. Check each one:</p>
        {CHECKS.map((c, i) => (
          <label key={c} className="check">
            <input type="checkbox" checked={ticked[i]} onChange={(e) => setTicked(ticked.map((t, j) => (j === i ? e.target.checked : t)))} data-testid={`drone-check-${i}`} />
            {c}
          </label>
        ))}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Not now
          </button>
          <button type="button" className="btn primary" disabled={!ticked.every(Boolean)} onClick={onConfirm} data-testid="drone-checklist-fly">
            Fly
          </button>
        </div>
      </section>
    </div>
  );
}

/** One recorded flight in the Flights panel. */
function FlightRow({ log, fresh, onSave, onReplay, onBlocks, onDelete }: { log: FlightLog; fresh?: boolean; onSave?(): void; onReplay(): void; onBlocks(): void; onDelete(): void }) {
  const sum = summarizeFlight(log);
  return (
    <div className={`drone-flight${fresh ? ' fresh' : ''}`} data-testid={fresh ? 'drone-flight-new' : 'drone-flight'}>
      <div className="drone-flight-head">
        <strong>{fresh ? 'Last flight (not saved)' : log.name}</strong>
        <span className="drone-muted">
          {log.target === 'tello' ? 'Tello' : 'Simulator'} · {sum.duration.toFixed(0)} s · {(sum.distance / 100).toFixed(1)} m · up to {sum.maxHeight} cm{sum.refused ? ` · ${sum.refused} refused` : ''}
        </span>
      </div>
      <div className="drone-flight-actions">
        {onSave && (
          <button type="button" className="btn small primary" onClick={onSave} data-testid="drone-flight-save">
            Save
          </button>
        )}
        <button type="button" className="btn small" onClick={onReplay} data-testid="drone-flight-replay">
          Replay
        </button>
        <button type="button" className="btn small" onClick={onBlocks} data-tip="Turn this flight into a program you can change and fly again" data-testid="drone-flight-blocks">
          Make blocks
        </button>
        <button type="button" className="btn small ghost" onClick={onDelete} aria-label={fresh ? 'Discard this flight' : `Delete ${log.name}`} data-testid="drone-flight-delete">
          {fresh ? 'Discard' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
