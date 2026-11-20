import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { checkLive, LiveRun, type BoardDefinition, type LiveBoard, type LiveOp, type LiveProblem, type WorkspaceJson } from '@tariro-studio/core';
import { registry } from '../registry';
import { debug } from '../debug/debugger';

export type LivePhase = 'idle' | 'connecting' | 'running';

export interface LiveStatus {
  ok: boolean;
  message: string;
}

/** Every pin operation goes to the Firmata connection in the main process. */
const remoteBoard: LiveBoard = (() => {
  const io = async (op: LiveOp): Promise<number | null> => {
    const r = await window.studio.live.io(op);
    if ('error' in r) throw new Error(r.error);
    return r.value;
  };
  return {
    digitalWrite: async (pin, on) => void (await io({ op: 'digitalWrite', pin, on })),
    analogWrite: async (pin, value) => void (await io({ op: 'analogWrite', pin, value })),
    servoWrite: async (pin, angle) => void (await io({ op: 'servoWrite', pin, angle })),
    digitalRead: async (pin, pullup) => (await io({ op: 'digitalRead', pin, pullup })) === 1,
    analogRead: async (channel) => (await io({ op: 'analogRead', channel })) ?? 0,
    analogPin: async (channel) => (await io({ op: 'analogPin', channel })) ?? undefined,
  };
})();

interface Options {
  /** Lines for the Output tab. */
  log(line: string, stream: 'stdout' | 'stderr' | 'info'): void;
  /** The block that is running now (null when none). */
  onBlock(blockId: string | null): void;
}

/**
 * Live mode: run the blocks on this computer and drive the board over Firmata. The program is a
 * snapshot taken at start; edits made while it runs take effect on the next run.
 */
export function useLive({ log, onBlock }: Options) {
  const [phase, setPhase] = useState<LivePhase>('idle');
  const [status, setStatus] = useState<LiveStatus | null>(null);
  /** The error that ended the last run, if any. */
  const [problems, setProblems] = useState<LiveProblem[]>([]);
  /**
   * The last start was refused because some blocks cannot run live. The caller then lists
   * `checkLive` problems for the workspace as it is now, so fixing a block clears its entry.
   */
  const [refused, setRefused] = useState(false);
  /** Set when the board has no Firmata firmware: the UI offers to install it. */
  const [needsFirmware, setNeedsFirmware] = useState<string | null>(null);
  const run = useRef<LiveRun | null>(null);
  const callbacks = useRef({ log, onBlock });
  useLayoutEffect(() => {
    callbacks.current = { log, onBlock };
  });

  const stop = useCallback(() => run.current?.stop(), []);

  // The board was unplugged while a program was running.
  useEffect(
    () =>
      window.studio.live.onState((s) => {
        if (!s.connected && s.error) run.current?.stop();
      }),
    [],
  );
  // Leaving the page (reload, close) must not leave motors running.
  useEffect(
    () => () => {
      run.current?.stop();
      void window.studio.live.disconnect(true);
    },
    [],
  );

  /** Resolves when the run is over; true when it left entries in `problems`. */
  const start = useCallback(async (workspace: WorkspaceJson, board: BoardDefinition, port: string): Promise<boolean> => {
    if (run.current) return false;
    const found = checkLive(workspace, board, registry);
    setProblems([]);
    setRefused(found.length > 0);
    if (found.length) {
      setStatus({ ok: false, message: found.length === 1 ? found[0]!.message : `${found.length} blocks cannot run in live mode. See Problems.` });
      return true;
    }
    const { log, onBlock } = callbacks.current;
    setPhase('connecting');
    setStatus(null);
    log(`Live mode: connecting to ${port}…`, 'info');
    const connected = await window.studio.live.connect(port);
    if (!connected.ok) {
      setPhase('idle');
      setStatus({ ok: false, message: connected.message });
      log(connected.message, 'stderr');
      if (connected.needsFirmware) setNeedsFirmware(port);
      return false;
    }
    log(connected.message, 'info');

    let pending = '';
    let lastBlock: string | null = null;
    let frame = 0;
    // Speed (PWM) pins of the board's own motor driver, stopped while the debugger pauses the program.
    const driverPins = board.onboard?.find((p) => p.kind === 'dual-motor-driver')?.pins ?? {};
    const speedPins = Object.entries(driverPins)
      .filter(([role]) => /^(EN|PWM)[AB]$/.test(role))
      .map(([, pin]) => pin);
    const held = new Map<number, number>();
    const live = new LiveRun(workspace, board, registry, {
      io: remoteBoard,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => performance.now(),
      print: (text) => {
        // The Output tab shows whole lines.
        const lines = (pending + text).split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) callbacks.current.log(line, 'stdout');
      },
      // The debugger (8c). A paused robot must not keep driving: the motor driver's speed pins go
      // to 0 (through the safety layer like any command) and get their speed back on Continue or Step.
      onPause: async (id) => {
        callbacks.current.onBlock(id);
        held.clear();
        for (const pin of speedPins) {
          const last = live.pinWatch.get(pin);
          if (last && last.mode === 'pwm' && last.value > 0) {
            held.set(pin, last.value);
            await remoteBoard.analogWrite(pin, 0);
          }
        }
        if (held.size) callbacks.current.log('Debugger: paused. The motors are stopped while the program is paused.', 'info');
        debug.refresh();
      },
      onResume: async () => {
        for (const [pin, value] of held) await remoteBoard.analogWrite(pin, value);
        held.clear();
        debug.refresh();
      },
      onBlock: (id) => {
        // Highlight at most once per frame; fast loops would otherwise flood the workspace.
        lastBlock = id ?? null;
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            callbacks.current.onBlock(lastBlock);
          });
      },
    });
    run.current = live;
    debug.attach(live, 'live');
    setPhase('running');
    const result = await live.run();
    debug.detach(live);
    run.current = null;
    if (pending) callbacks.current.log(pending, 'stdout');
    cancelAnimationFrame(frame);
    onBlock(result.outcome === 'error' ? (result.blockId ?? null) : null);
    // A finished program leaves its pins as they are (an LED it turned on stays on); stopping or
    // an error switches everything off.
    await window.studio.live.disconnect(result.outcome !== 'finished');
    if (result.outcome === 'error') setProblems([{ message: result.message, ...(result.blockId ? { blockId: result.blockId } : {}) }]);
    const message = result.outcome === 'finished' ? 'Live: the program finished.' : result.outcome === 'stopped' ? 'Live: stopped. The pins are switched off.' : `Live: ${result.message}`;
    callbacks.current.log(message, result.outcome === 'error' ? 'stderr' : 'info');
    setStatus({ ok: result.outcome !== 'error', message });
    setPhase('idle');
    return result.outcome === 'error';
  }, []);

  return {
    phase,
    status,
    problems,
    refused,
    clearProblems: useCallback(() => setProblems([]), []),
    needsFirmware,
    dismissFirmware: useCallback(() => setNeedsFirmware(null), []),
    start,
    stop,
  };
}
