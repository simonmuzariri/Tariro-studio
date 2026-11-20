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
  type IconType,
  Cog,
  Bot,
  RotateCcw,
  CircuitBoard,
  PanelLeftOpen,
  Undo2,
  Redo2,
  X,
} from '../ui/icons';
import {
  ON_TABLE,
  separateBoard,
  turnAboutMiddle,
  nextTurn,
  type PartTurn,
  COLUMNS,
  columnsOf,
  parseHole,
  boardPinOrder,
  boardInUse,
  breadboardInUse,
  showsBoard,
  showsBreadboard,
  canonicalPin,
  isMotorTerminal,
  motorTerminalName,
  motorTerminals,
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
import { BenchScene, BOARD_ID, BREADBOARD_ID, type BenchMode, type Probe } from './scene';
import { Instruments, type ProbeSlot } from './Instruments';

interface Props {
  board: BoardDefinition;
  /** Boards the learner can put on the bench (choosing one changes the project's board). */
  boards: readonly BoardDefinition[];
  onBoard(id: string): void;
  workspace: WorkspaceJson;
  theme: ThemeName;
  layout: CircuitLayout | undefined;
  onChange(layout: CircuitLayout): void;
  simulation: Simulation;
  /** Why the program cannot be run now (live mode is using the board). */
  blocked?: string | undefined;
}

const PALETTE: Array<[PlaceableKind, IconType, string]> = [
  ['led', Lightbulb, 'LED'],
  ['resistor', SquareDot, 'Resistor'],
  ['button', CircleDot, 'Push button'],
  ['switch', ToggleLeft, 'Slide switch'],
  ['potentiometer', RotateCw, 'Potentiometer'],
  ['buzzer', Volume2, 'Buzzer'],
  ['dc-motor', Cog, 'DC motor'],
  ['chassis', Bot, 'Robot car'],
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
  if (isMotorTerminal(node)) return motorTerminalName(node);
  return `pin ${pinLabel(board, node)}`;
}

/**
 * The 3D workbench: build a circuit on a breadboard next to the board, then run the blocks on it.
 * Parts are added from the palette at the first free place and dragged to move; wires are drawn
 * by clicking two connection points, or added from the properties panel with a pin picker.
 */
export default function Workbench({ board, boards, onBoard, workspace, theme, layout: stored, onChange, simulation: sim, blocked }: Props) {
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

  // Undo and redo: every change made on the bench is remembered (up to 100). A change from outside
  // (another project opened, the board changed in the toolbar) starts the history again.
  type History = { past: CircuitLayout[]; future: CircuitLayout[]; own: string };
  const [history, setHistory] = useState<History>({ past: [], future: [], own: '' });
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  });
  const remember = useCallback((h: History, next: CircuitLayout) => {
    historyRef.current = h;
    setHistory(h);
    live.current.onChange(next);
  }, []);
  const update = useCallback(
    (wanted: CircuitLayout, forBoard?: BoardDefinition) => {
      // The board never ends up on the breadboard: a turn, a bigger breadboard or a bigger board moves it aside, in the same step.
      const next = separateBoard(wanted, forBoard ?? live.current.board);
      if (next !== wanted) setNotice('The board would have sat on the breadboard, so it was moved aside.');
      const h = historyRef.current;
      const now = live.current.layout;
      const fresh = JSON.stringify(now) === h.own;
      remember({ past: [...(fresh ? h.past : []), now].slice(-100), future: [], own: JSON.stringify(next) }, next);
    },
    [remember],
  );
  const undo = useCallback(() => {
    const h = historyRef.current;
    const now = live.current.layout;
    const prev = h.past.at(-1);
    if (!prev || JSON.stringify(now) !== h.own) return;
    remember({ past: h.past.slice(0, -1), future: [...h.future, now], own: JSON.stringify(prev) }, prev);
  }, [remember]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    const now = live.current.layout;
    const next = h.future.at(-1);
    if (!next || JSON.stringify(now) !== h.own) return;
    remember({ past: [...h.past, now], future: h.future.slice(0, -1), own: JSON.stringify(next) }, next);
  }, [remember]);

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
          moveBoard: (at) => {
            const l = live.current.layout;
            update({ ...l, boardAt: { x: at.x, z: at.z, turn: l.boardAt?.turn ?? 0 } });
          },
          moveBreadboard: (at) => {
            const l = live.current.layout;
            update({ ...l, breadboardAt: at });
          },
          updateWire: (id, patch) => {
            const l = live.current.layout;
            update({
              ...l,
              wires: l.wires.map((w) => {
                if (w.id !== id) return w;
                const next = { ...w, ...patch };
                if (next.via && next.via.length === 0) delete next.via;
                return next;
              }),
            });
          },
        },
        theme,
      );
      // The palette (left) and the properties panel (right) float over the view.
      scene.current.setInsets(172, 284);
      // Test hook: where a hole or pin is on screen, so automated tests can click it in 3D.
      (window as unknown as { __tariroBench?: unknown }).__tariroBench = {
        screenOf: (id: string) => scene.current?.screenOf(id),
        screenOfBoard: () => scene.current?.screenOfBoard(),
        screenOfBreadboard: () => scene.current?.screenOfBreadboard(),
        screenOfWire: (id: string) => scene.current?.screenOfWire(id),
        layout: () => scene.current?.currentLayout(),
        wheelTurns: (id: string) => scene.current?.wheelTurns(id),
        carPosition: () => scene.current?.carPosition(),
      };
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

  // The Parts list and the properties panel can be closed to see the whole bench (a robot car driving).
  const [partsOpen, setPartsOpen] = useStoredOpen('tariro.bench.parts');
  const [propsOpen, setPropsOpen] = useStoredOpen('tariro.bench.props');
  // The bench centres in the room the open panels leave (the instruments take the properties panel's place).
  useEffect(() => scene.current?.setInsets(partsOpen ? 172 : 12, instrumentsOpen ? 12 : propsOpen ? 284 : 12), [instrumentsOpen, partsOpen, propsOpen]);
  useEffect(() => scene.current?.setTheme(theme), [theme]);
  useEffect(() => scene.current?.setBoard(board), [board]);
  useEffect(() => scene.current?.setLayout(layout), [layout]);
  useEffect(() => scene.current?.setSelection(selected), [selected, layout]);
  // Placing a probe takes over the bench until the point is chosen.
  useEffect(() => scene.current?.setMode(probeSlot ? { kind: 'probe' } : mode), [mode, probeSlot]);
  useEffect(() => scene.current?.setSimulation(sim.state, sim.running));

  // A project opened (or a board chosen in the toolbar) with the board on the breadboard: move it aside,
  // as part of what was opened, so undo does not bring the overlap back.
  useEffect(() => {
    const fixed = separateBoard(layout, board);
    if (fixed === layout) return;
    const h = historyRef.current;
    const fresh = JSON.stringify(layout) === h.own;
    remember({ past: fresh ? h.past : [], future: fresh ? h.future : [], own: JSON.stringify(fixed) }, fixed);
  }, [layout, board, remember]);
  const historyFresh = JSON.stringify(layout) === history.own;
  const canUndo = historyFresh && history.past.length > 0;
  const canRedo = historyFresh && history.future.length > 0;
  const part = layout.parts.find((p) => p.id === selected);
  const wire = layout.wires.find((w) => w.id === selected);

  /** The board's motor terminals with no motor on them yet. */
  const boardShown = showsBoard(layout);
  const freeTerminals = boardShown ? motorTerminals(board).filter((m) => !layout.parts.some((p) => p.terminal === m)) : [];
  const driverPins = (m: 'A' | 'B') => {
    const pins = board.onboard?.find((o) => o.kind === 'dual-motor-driver')?.pins;
    return `${pins?.[`IN${m}`]} and ${pins?.[`EN${m}`]}`;
  };
  const breadboardShown = showsBreadboard(layout);
  /** Parts that plug into the breadboard (a motor can go on the board's terminals instead). */
  const needsBreadboard = (kind: PlaceableKind) => kind !== 'chassis' && !(kind === 'dc-motor' && freeTerminals.length > 0);
  const breadboardCols = columnsOf(layout);
  /** Half size (400 holes) or full size (830 holes); going smaller only when nothing is past column 30. */
  const setBreadboardSize = (size: 'half' | 'full') => {
    if (size === (layout.breadboardSize ?? 'half')) return;
    if (size === 'half') {
      const far = (id: string) => (parseHole(id)?.col ?? Number(/\d+$/.exec(id)?.[0] ?? 0)) > COLUMNS && id.startsWith('bb:');
      if (layout.parts.some((p) => (legHoles(p) ?? []).some(far)) || layout.wires.some((w) => far(w.from) || far(w.to)))
        return setNotice('Some parts or wires are past column 30. Move them to columns 1–30 first, then make the breadboard smaller.');
    }
    const { breadboardSize: _old, ...rest } = layout;
    void _old;
    update({ ...rest, breadboard: true, ...(size === 'full' ? { breadboardSize: 'full' as const } : {}) });
    setNotice(size === 'full' ? 'Full-size breadboard: 830 holes, 63 columns.' : 'Half-size breadboard: 400 holes, 30 columns.');
  };
  const setBreadboardTurn = (q: number) => {
    const at = layout.breadboardAt ?? { x: 0, z: 0 };
    update({ ...layout, breadboardAt: { ...at, turn: q % 4 } });
  };
  const toggleBreadboard = () => {
    if (breadboardShown && breadboardInUse(layout)) return setNotice('Take the parts and wires off the breadboard first, then put it away.');
    update({ ...layout, breadboard: !breadboardShown });
    setNotice(breadboardShown ? 'Breadboard put away.' : 'Breadboard on the bench. Add parts to it from the list.');
  };
  const boardName = board.name.replace(/\s*\(.*\)$/, '');
  const toggleBoard = () => {
    if (boardShown && boardInUse(layout)) return setNotice('Take the wires and motors off the board first, then put it away.');
    const car = layout.parts.some((p) => p.kind === 'chassis');
    // Put on the robot car, the board gets the car's two motors on its terminals (left = Motor A, right = Motor B).
    const motors = !boardShown && car ? motorTerminals(board).filter((m) => !layout.parts.some((p) => p.terminal === m)).map((terminal) => ({ id: newId('dc-motor'), kind: 'dc-motor' as const, row: 0, col: 1, rotation: 0 as const, terminal })) : [];
    update({ ...layout, board: !boardShown, parts: [...layout.parts, ...motors] });
    setNotice(
      boardShown
        ? `${boardName} put away.`
        : car && motors.length
          ? `${boardName} on the robot car: the left motor is wired to Motor A (pins ${driverPins('A')}) and the right one to Motor B (pins ${driverPins('B')}).`
          : `${boardName} on the bench${car ? ', on the robot car' : ''}. Change it with Board in the toolbar.`,
    );
  };
  /** Put another kind of board on the bench: the project is then for that board. */
  const chooseBoard = (id: string) => {
    if (id === board.id) return;
    const next = boards.find((b) => b.id === id);
    onBoard(id);
    update({ ...layout, board: true }, next);
    setSelected(BOARD_ID);
    setNotice(`${next?.name.replace(/\s*\(.*\)$/, '') ?? 'Board'} on the bench. Your program is now for this board; wires to pins it does not have are shown as problems.`);
  };
  const setBoardTurn = (q: number) => {
    const at = layout.boardAt ?? { x: ON_TABLE.x, z: ON_TABLE.z, turn: 0 };
    update({ ...layout, boardAt: { ...at, turn: q % 4 } });
  };
  const addPart = (kind: PlaceableKind) => {
    if (kind === 'chassis') {
      const existing = layout.parts.find((p) => p.kind === 'chassis');
      if (existing) {
        setSelected(existing.id);
        return setNotice('The robot car is already on the bench.');
      }
      // The car comes with its two motors: on a board with motor terminals they are wired to Motor A (left) and B (right).
      const id = newId(kind);
      const motors = freeTerminals.map((terminal) => ({ id: newId('dc-motor'), kind: 'dc-motor' as const, row: 0, col: 1, rotation: 0 as const, terminal }));
      update({ ...layout, parts: [...layout.parts, { id, kind, row: 0, col: 1, rotation: 0 }, ...motors] });
      setSelected(id);
      setMode({ kind: 'select' });
      setNotice(
        !boardShown
          ? 'Robot car added. Put a board on it (Board, in the list) to wire its motors.'
          : motorTerminals(board).length
            ? `Robot car added: the board is on its deck, the left motor is wired to Motor A (pins ${driverPins('A')}) and the right one to Motor B (pins ${driverPins('B')}).`
            : 'Robot car added, with the board on its deck. This board has no motor terminals: wire the motors through a motor driver.',
      );
      return;
    }
    // On a board with motor terminals a motor goes there first, as on the real robot.
    const terminal = kind === 'dc-motor' ? freeTerminals[0] : undefined;
    if (terminal) {
      const id = newId(kind);
      update({ ...layout, parts: [...layout.parts, { id, kind, row: 0, col: 1, rotation: 0, terminal }] });
      setSelected(id);
      setMode({ kind: 'select' });
      setNotice(`DC motor added to the Motor ${terminal} terminal. The board drives it from pins ${driverPins(terminal)}.`);
      return;
    }
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
  /** Turn a part (or the robot car) to face another way; a part needs room for its legs there. */
  const setPartTurn = useCallback(
    (id: string, rotation: PartTurn) => {
      const l = live.current.layout;
      const p = l.parts.find((x) => x.id === id);
      if (!p || p.terminal) return;
      // Turned about its middle when there is room, else about its first leg.
      const spot = p.kind === 'chassis' ? { row: p.row, col: p.col } : [turnAboutMiddle(p, rotation), { row: p.row, col: p.col }].find((at) => at.row >= 0 && at.col >= 1 && canPlace(l, { ...p, ...at, rotation }, p.id));
      if (!spot) return setNotice('There is no room to turn it here. Move it first.');
      update({ ...l, parts: l.parts.map((x) => (x.id === id ? { ...x, ...spot, rotation } : x)) });
    },
    [update],
  );
  const rotate = useCallback(() => {
    const l = live.current.layout;
    const p = l.parts.find((x) => x.id === selected);
    if (!p) return;
    setPartTurn(p.id, nextTurn(p.rotation));
  }, [selected, setPartTurn]);
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
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (e.key === 'y' || e.key === 'Y' || e.shiftKey) redo();
        else undo();
        return;
      }
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
  }, [remove, rotate, undo, redo]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const partState = (id: string) => sim.state.parts[id];
  const labelOf = (id: string) => {
    const kind = layout.parts.find((p) => p.id === id)?.kind;
    return sim.sim.circuit.parts.find((p) => p.id === id)?.label ?? (kind ? PART_KINDS[kind].name : id);
  };
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

      {partsOpen ? (
      <aside className="bench-palette" aria-label="Parts">
        <span className="bench-heading bench-heading-row">
          Bench
          <button type="button" className="btn ghost icon-only small" onClick={() => setPartsOpen(false)} aria-label="Close the parts list" data-tip="Close the parts list to see more of the bench" data-testid="bench-parts-close">
            <X className="icon sm" />
          </button>
        </span>
        <button type="button" className={`bench-tool ${boardShown ? 'active' : ''}`} onClick={toggleBoard} disabled={sim.running} aria-pressed={boardShown} data-tip={boardShown ? `Put the ${boardName} away` : `Put the ${boardName} on the bench`} data-testid="bench-add-board">
          <CircuitBoard className="icon" aria-hidden="true" />
          <span>Board</span>
        </button>
        <select className="bench-board-choice" value={board.id} onChange={(e) => chooseBoard(e.target.value)} disabled={sim.running} aria-label="Which board" data-tip="Which board is on the bench (your program is for this board)" data-testid="bench-board-choice">
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name.replace(/\s*\(.*\)$/, '').replace(/^Arduino\s+/, '').replace(/\s+Robotics$/, '').replace(/\s+2560$/, '')}
            </option>
          ))}
        </select>
        <button type="button" className={`bench-tool ${breadboardShown ? 'active' : ''}`} onClick={toggleBreadboard} disabled={sim.running} aria-pressed={breadboardShown} data-tip={breadboardShown ? 'Put the breadboard away (when nothing is plugged into it)' : 'Put a breadboard on the bench'} data-testid="bench-breadboard">
          <SquareDot className="icon" aria-hidden="true" />
          <span>Breadboard</span>
        </button>
        <select className="bench-board-choice" value={layout.breadboardSize ?? 'half'} onChange={(e) => setBreadboardSize(e.target.value as 'half' | 'full')} disabled={sim.running} aria-label="Breadboard size" data-tip="Half size (400 holes) or full size (830 holes)" data-testid="bench-breadboard-size">
          <option value="half">400 holes (half)</option>
          <option value="full">830 holes (full)</option>
        </select>
        <span className="bench-heading">Parts</span>
        {PALETTE.map(([kind, Icon, name]) => (
          <button
            key={kind}
            type="button"
            className="bench-tool"
            onClick={() => addPart(kind)}
            disabled={sim.running || (!breadboardShown && needsBreadboard(kind))}
            data-tip={!breadboardShown && needsBreadboard(kind) ? 'Put a breadboard on the bench first' : kind === 'chassis' ? 'Add a robot car chassis: the board goes on its deck, with two motors' : `Add a ${name.toLowerCase()} to the breadboard`}
            data-testid={`bench-add-${kind}`}
          >
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
      ) : (
        <button type="button" className="btn small bench-reopen left" onClick={() => setPartsOpen(true)} data-tip="Open the parts list" data-testid="bench-parts-open">
          <PanelLeftOpen className="icon sm" />
          Parts
        </button>
      )}

      <div className={`bench-top${partsOpen ? '' : ' shifted'}`}>
        {sim.running ? (
          <button type="button" className="btn small primary" onClick={sim.stop} data-testid="bench-stop">
            <Square className="icon sm" fill="currentColor" />
            Stop
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={() => void sim.start()} disabled={!sim.canRun} data-tip={blocked ?? sim.problems.find((p) => p.severity === 'error' && !p.check)?.message ?? 'Run the blocks on this circuit'} data-testid="bench-run">
            <Play className="icon sm" fill="currentColor" />
            Run
          </button>
        )}
        <span className="tb-sep" />
        <button type="button" className="btn small ghost icon-only" onClick={undo} disabled={sim.running || !canUndo} aria-label="Undo" data-tip="Undo" data-keys="Ctrl+Z" data-testid="bench-undo">
          <Undo2 className="icon sm" />
        </button>
        <button type="button" className="btn small ghost icon-only" onClick={redo} disabled={sim.running || !canRedo} aria-label="Redo" data-tip="Redo" data-keys="Ctrl+Y" data-testid="bench-redo">
          <Redo2 className="icon sm" />
        </button>
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

      {!propsOpen && !instrumentsOpen && (
        <button type="button" className="btn small bench-reopen right" onClick={() => setPropsOpen(true)} data-tip="Open the details panel" data-testid="bench-props-open">
          <PanelLeftOpen className="icon sm flip" />
          Details
        </button>
      )}
      <aside className="bench-props" aria-label="Properties" data-testid="bench-props" hidden={!propsOpen}>
        <button type="button" className="btn ghost icon-only small bench-props-close" onClick={() => setPropsOpen(false)} aria-label="Close the details panel" data-tip="Close the details panel to see more of the bench" data-testid="bench-props-close">
          <X className="icon sm" />
        </button>
        {part ? (
          <>
            <h3>{labelOf(part.id)}</h3>
            <p className="bench-muted">
              {part.kind === 'chassis' ? (
                'Carries the board on its deck. The left motor is Motor A and the right one Motor B; the ball caster is at the front.'
              ) : part.terminal ? (
                `${layout.parts.some((p) => p.kind === 'chassis') ? `The car's ${part.terminal === 'A' ? 'left' : 'right'} motor. ` : ''}Wires in the Motor ${part.terminal} terminal, driven by pins ${driverPins(part.terminal)}`
              ) : (
                <>
                  First leg in hole {ROWS[part.row]}
                  {part.col}
                  {part.rotation ? `, turned ${part.rotation}°` : ''}
                </>
              )}
            </p>
            {part.kind === 'dc-motor' && motorTerminals(board).length > 0 && (
              <label className="bench-field">
                Wires go to
                <select
                  value={part.terminal ?? ''}
                  disabled={sim.running}
                  data-testid="bench-motor-terminal"
                  onChange={(e) => {
                    const t = e.target.value as 'A' | 'B' | '';
                    if (t) return patchPart(part.id, { terminal: t });
                    const spot = firstFreeSpot({ ...layout, parts: layout.parts.filter((p) => p.id !== part.id) }, 'dc-motor');
                    if (!spot) return setNotice('The breadboard is full. Remove a part to make room.');
                    update({ ...layout, parts: layout.parts.map((p) => (p.id === part.id ? { id: p.id, kind: p.kind, ...spot } : p)) });
                  }}
                >
                  {motorTerminals(board).map((m) => (
                    <option key={m} value={m} disabled={m !== part.terminal && !freeTerminals.includes(m)}>
                      Motor {m} terminal (pins {driverPins(m)})
                    </option>
                  ))}
                  <option value="">Breadboard holes</option>
                </select>
              </label>
            )}
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
                      {hole?.startsWith('pin:') ? (
                        <>
                          <b>{leg.name}</b> in {motorTerminalName(hole.slice(4))}
                        </>
                      ) : (
                        <>
                          <b>{leg.name}</b> in {hole?.slice(3)}: {nodeName(board, hole ? sim.nodeAt(hole) : undefined, hole ? sim.linksOn(sim.nodeAt(hole) ?? '') : 0)}
                        </>
                      )}
                    </span>
                    {hole && !hole.startsWith('pin:') && !sim.running && boardShown && (
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
              {part.kind === 'chassis' && (
                <button type="button" className="btn small" onClick={() => scene.current?.resetCar()} data-tip="Pick the car up and put it back where it started" data-testid="bench-car-reset">
                  <RotateCcw className="icon sm" />
                  Put the car back
                </button>
              )}
              {!part.terminal && (
                <Orientation turn={part.rotation / 90} onTurn={(q) => setPartTurn(part.id, ((q * 90) % 360) as PartTurn)} disabled={sim.running} turnTestId="bench-rotate" what={part.kind === 'chassis' ? 'car' : 'part'} />
              )}
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
              From {wire.from.startsWith('pin:') ? `pin ${canonicalPin(wire.from.slice(4))}` : wire.from.slice(3)} to {wire.to.startsWith('pin:') ? `pin ${canonicalPin(wire.to.slice(4))}` : wire.to.slice(3)}
            </p>
            <p className="bench-muted" data-testid="bench-wire-help">
              Drag the wire to bend it, drag a white end to another hole or pin, and double-click a yellow bend to take it out.
            </p>
            <div className="bench-swatches" role="radiogroup" aria-label="Wire colour">
              {WIRE_COLOURS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={c === wire.colour} aria-label={WIRE_NAMES[c]} className={`swatch ${c === wire.colour ? 'on' : ''}`} style={{ background: c }} onClick={() => update({ ...layout, wires: layout.wires.map((w) => (w.id === wire.id ? { ...w, colour: c } : w)) })} />
              ))}
            </div>
            <div className="bench-actions">
              {wire.via && (
                <button type="button" className="btn small" onClick={() => update({ ...layout, wires: layout.wires.map((w) => (w.id === wire.id ? { id: w.id, from: w.from, to: w.to, colour: w.colour } : w)) })} disabled={sim.running} data-testid="bench-wire-straighten">
                  <RotateCcw className="icon sm" />
                  Straighten
                </button>
              )}
              <button type="button" className="btn small" onClick={remove} disabled={sim.running} data-testid="bench-delete">
                <Trash2 className="icon sm" />
                Remove
              </button>
            </div>
          </>
        ) : selected === BOARD_ID && boardShown ? (
          <>
            <h3>{boardName}</h3>
            <p className="bench-muted" data-testid="bench-board-help">
              {layout.parts.some((p) => p.kind === 'chassis') ? 'It rides on the robot car’s deck. Take the car away to move the board around the bench.' : 'Drag it to move it anywhere on the bench, and turn it to put its pins where you want them. Wires stay plugged in.'}
            </p>
            <label className="bench-field">
              Board
              <select value={board.id} onChange={(e) => chooseBoard(e.target.value)} disabled={sim.running} data-testid="bench-board-select">
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="bench-actions">
              {!layout.parts.some((p) => p.kind === 'chassis') && <Orientation turn={layout.boardAt?.turn ?? 0} onTurn={(q) => setBoardTurn(q)} disabled={sim.running} turnTestId="bench-board-turn" what="board" />}
              {layout.boardAt && (
                <button type="button" className="btn small" onClick={() => update({ ...layout, boardAt: undefined })} disabled={sim.running} data-tip="Put it back where it started" data-testid="bench-board-reset">
                  <RotateCcw className="icon sm" />
                  Back to its place
                </button>
              )}
            </div>
          </>
        ) : selected === BREADBOARD_ID && breadboardShown ? (
          <>
            <h3>Breadboard</h3>
            <p className="bench-muted">
              {breadboardCols === COLUMNS ? 'Half size: 400 holes, 30 columns.' : 'Full size: 830 holes, 63 columns.'} Drag it to move it, with everything plugged into it, and turn it. Holes in a column of five are joined; the centre gap and the rows are not.
            </p>
            <div className="bench-actions">
              <Orientation turn={layout.breadboardAt?.turn ?? 0} onTurn={(q) => setBreadboardTurn(q)} disabled={sim.running} turnTestId="bench-breadboard-turn" what="breadboard" />
              {layout.breadboardAt && (
                <button type="button" className="btn small" onClick={() => update({ ...layout, breadboardAt: undefined })} disabled={sim.running} data-testid="bench-breadboard-reset">
                  <RotateCcw className="icon sm" />
                  Back to its place
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h3>On the bench</h3>
            {layout.parts.length === 0 ? (
              <p className="bench-muted" data-testid="bench-empty">
                {boardShown || breadboardShown
                  ? 'Add parts from the left, or press “Build from blocks”. Drag to move, and draw wires with the Wire tool.'
                  : 'The bench is empty. Put a board and a breadboard on it from the list on the left, add a robot car, or press “Build from blocks”.'}
              </p>
            ) : (
              <ul className="bench-list" data-testid="bench-list">
                {layout.parts.map((p) => (
                  <li key={p.id} data-testid={`bench-item-${p.kind}`} data-id={p.id} data-level={(partState(p.id)?.level ?? 0).toFixed(2)}>
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

/** A panel's open or closed state, remembered on this computer (open unless closed before). */
function useStoredOpen(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== 'closed';
    } catch {
      return true;
    }
  });
  const set = useCallback(
    (o: boolean) => {
      setOpen(o);
      try {
        localStorage.setItem(key, o ? 'open' : 'closed');
      } catch {
        /* storage unavailable: the choice lasts until the app closes */
      }
    },
    [key],
  );
  return [open, set];
}

function reading(s: { volts: number; milliamps: number; level: number; input?: number } | undefined, kind: PlaceableKind): string {
  if (!s) return '';
  if (kind === 'led') return s.level > 0.01 ? `on · ${s.milliamps.toFixed(1)} mA` : 'off';
  if (kind === 'buzzer') return s.level > 0 ? 'sounding' : 'silent';
  if (kind === 'dc-motor') return s.level === 0 ? 'stopped' : `${s.level > 0 ? 'forward' : 'backwards'} · ${Math.round(Math.abs(s.level) * 100)} % · ${Math.abs(s.milliamps).toFixed(0)} mA`;
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

/**
 * Which way a component lies: horizontal or vertical, and a quarter turn at a time all the way round
 * (so a part can also be turned end for end). `turn` is in quarter turns.
 */
function Orientation({ turn, onTurn, disabled, turnTestId, what }: { turn: number; onTurn(q: number): void; disabled: boolean; turnTestId: string; what: 'part' | 'board' | 'breadboard' | 'car' }) {
  const vertical = turn % 2 === 1;
  const facing = ['away from you', 'to the left', 'towards you', 'to the right'][turn % 4];
  return (
    <div className="bench-orient" role="group" aria-label="Which way it lies" data-testid={`bench-orient-${what}`}>
      <div className="bench-orient-row">
        <button type="button" className={`btn small ${!vertical ? 'primary' : ''}`} aria-pressed={!vertical} onClick={() => vertical && onTurn(turn + 1)} disabled={disabled} data-testid={`bench-${what}-horizontal`}>
          Horizontal
        </button>
        <button type="button" className={`btn small ${vertical ? 'primary' : ''}`} aria-pressed={vertical} onClick={() => !vertical && onTurn(turn + 1)} disabled={disabled} data-testid={`bench-${what}-vertical`}>
          Vertical
        </button>
        <button type="button" className="btn small" onClick={() => onTurn(turn + 1)} disabled={disabled} data-keys={what === 'part' ? 'R' : undefined} data-tip="Turn it a quarter turn" data-testid={turnTestId}>
          <RotateCw className="icon sm" />
          Turn
        </button>
      </div>
      <span className="bench-muted">{what === 'car' ? `Faces ${facing}` : `Turned ${(turn % 4) * 90}°`}</span>
    </div>
  );
}

