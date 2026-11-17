import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { analyseLayout, checkLive, CircuitSimulator, LiveRun, type BoardDefinition, type CircuitLayout, type SimState, type WorkspaceJson } from '@tariro-studio/core';
import { deriveCircuit, type WiringStep } from '@tariro-studio/extensions';
import { registry } from '../registry';

export interface SimProblem {
  message: string;
  severity: 'error' | 'warning';
  /** A part on the workbench this is about. */
  partId?: string;
}

export interface Simulation {
  sim: CircuitSimulator;
  state: SimState;
  /** Where the circuit comes from: worked out from the blocks, or built by hand on the workbench. */
  source: 'blocks' | 'bench';
  /** For a circuit worked out from the blocks: how to build it on a breadboard. */
  wiring: WiringStep[];
  /** Why the program cannot run, and warnings about the circuit. */
  problems: SimProblem[];
  canRun: boolean;
  running: boolean;
  outcome: { ok: boolean; message: string } | null;
  /** Which pin or rail each workbench connection point is joined to. */
  nodeAt(id: string): string | undefined;
  /** How many legs and wire ends share a node. */
  linksOn(node: string): number;
  start(): Promise<void>;
  stop(): void;
}

interface Options {
  workspace: WorkspaceJson;
  board: BoardDefinition;
  /** The project's workbench; used when it has parts on it. */
  layout: CircuitLayout | undefined;
  log(line: string, stream: 'stdout' | 'stderr' | 'info'): void;
  onBlock(blockId: string | null): void;
  /** Set when something else drives the block highlight (live mode). */
  blocked: string | undefined;
}

/**
 * The one simulation of the open project. The Simulator tab and the 3D workbench both show it,
 * and the block program drives it through the same interpreter as live mode.
 */
export function useSimulation({ workspace, board, layout, log, onBlock, blocked }: Options): Simulation {
  const fromBench = (layout?.parts.length ?? 0) > 0;
  const derived = useMemo(() => deriveCircuit(workspace, board), [workspace, board]);
  const analysis = useMemo(() => (layout && fromBench ? analyseLayout(layout, board) : undefined), [layout, fromBench, board]);
  const circuit = analysis ? analysis.circuit : derived.circuit;
  // Rebuild the simulator only when the circuit itself changes, so editing an unrelated block
  // does not reset switches and sliders.
  const circuitKey = JSON.stringify(circuit);
  const sim = useMemo(() => new CircuitSimulator(circuit, board), [circuitKey, board]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, repaint] = useState(0);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const run = useRef<LiveRun | null>(null);
  const callbacks = useRef({ log, onBlock });
  useLayoutEffect(() => {
    callbacks.current = { log, onBlock };
  });

  const problems = useMemo<SimProblem[]>(() => {
    const out: SimProblem[] = [];
    for (const p of checkLive(workspace, board, registry, 'simulation')) if (!out.some((o) => o.message === p.message)) out.push({ message: p.message, severity: 'error' });
    for (const p of analysis?.problems ?? []) out.push({ message: p.message, severity: p.severity, ...(p.id ? { partId: p.id } : {}) });
    return out;
  }, [workspace, board, analysis]);

  useEffect(() => {
    let frame = 0;
    sim.onChange(() => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          repaint((n) => n + 1);
        });
    });
    return () => {
      cancelAnimationFrame(frame);
      sim.onChange(undefined);
      // A different circuit (or leaving the page) ends the run that was driving the old one.
      run.current?.stop();
    };
  }, [sim]);

  const stop = useCallback(() => run.current?.stop(), []);
  const canRun = !blocked && !problems.some((p) => p.severity === 'error');

  const start = useCallback(async () => {
    if (run.current || !canRun) return;
    sim.reset();
    setOutcome(null);
    let pending = '';
    let lastBlock: string | null = null;
    let frame = 0;
    const r = new LiveRun(
      workspace,
      board,
      registry,
      {
        io: sim,
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
        now: () => performance.now(),
        print: (text) => {
          const lines = (pending + text).split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) callbacks.current.log(line, 'stdout');
        },
        onBlock: (id) => {
          lastBlock = id ?? null;
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              callbacks.current.onBlock(lastBlock);
            });
        },
      },
      'simulation',
    );
    run.current = r;
    setRunning(true);
    callbacks.current.log(`Simulator: running the program on the ${fromBench ? 'workbench circuit' : 'circuit worked out from the blocks'}…`, 'info');
    const result = await r.run();
    run.current = null;
    cancelAnimationFrame(frame);
    if (pending) callbacks.current.log(pending, 'stdout');
    callbacks.current.onBlock(result.outcome === 'error' ? (result.blockId ?? null) : null);
    // Stopping is like pulling the plug: every pin goes back to unused. A program that ends by
    // itself leaves its outputs as they are, as a real board would.
    if (result.outcome !== 'finished') sim.reset();
    const message = result.outcome === 'finished' ? 'Simulator: the program finished.' : result.outcome === 'stopped' ? 'Simulator: stopped.' : `Simulator: ${result.message}`;
    callbacks.current.log(message, result.outcome === 'error' ? 'stderr' : 'info');
    setOutcome({ ok: result.outcome !== 'error', message });
    setRunning(false);
  }, [canRun, sim, workspace, board, fromBench]);

  return {
    sim,
    state: sim.getState(),
    source: fromBench ? 'bench' : 'blocks',
    wiring: fromBench ? [] : derived.wiring,
    problems,
    canRun,
    running,
    outcome,
    nodeAt: analysis ? analysis.nodeAt : () => undefined,
    linksOn: analysis ? analysis.linksOn : () => 0,
    start,
    stop,
  };
}
