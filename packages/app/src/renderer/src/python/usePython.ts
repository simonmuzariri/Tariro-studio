import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PythonHostMessage, PythonResult, PythonWorkerMessage } from '@tariro-studio/core';

export type PythonPhase = 'idle' | 'loading' | 'running' | 'stopping';

export interface ConsoleLine {
  id: number;
  stream: 'stdout' | 'stderr' | 'info';
  text: string;
}

interface Options {
  /** The USB port the board is on ('' when none). Read when the program first uses the board. */
  port: string;
}

/** How long a program gets to notice Stop before its worker is ended. */
const STOP_GRACE_MS = 600;
const MAX_LINES = 2000;

/**
 * The Python environment's runtime: Pyodide in a worker, board commands over the live-mode
 * USB link (connected on the first board command, released when the program ends).
 */
export function usePython({ port }: Options) {
  const [phase, setPhase] = useState<PythonPhase>('idle');
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [result, setResult] = useState<PythonResult | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const finish = useRef<((r: PythonResult) => void) | null>(null);
  const connected = useRef(false);
  const portRef = useRef(port);
  useLayoutEffect(() => {
    portRef.current = port;
  });
  const lineId = useRef(0);

  const print = useCallback((stream: ConsoleLine['stream'], text: string) => {
    setLines((old) => {
      const next = [...old, ...text.split('\n').map((t) => ({ id: ++lineId.current, stream, text: t }))];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  const send = (w: Worker, m: PythonHostMessage) => w.postMessage(m);

  /** One board command from the program; connects first. Errors go back to Python as BoardError. */
  const boardCall = useCallback(async (m: Extract<PythonWorkerMessage, { kind: 'io' }>, w: Worker) => {
    try {
      if (!connected.current) {
        const p = portRef.current;
        if (!p) throw new Error('No board found. Plug in the board and choose its USB port in the toolbar.');
        print('info', `Connecting to the board on ${p}…`);
        const c = await window.studio.live.connect(p);
        if (!c.ok) throw new Error(c.needsFirmware ? `${c.message} Install the live firmware from the Run live button, then run again.` : c.message);
        connected.current = true;
        print('info', c.message);
      }
      const r = await window.studio.live.io(m.op);
      if ('error' in r) throw new Error(r.error);
      send(w, { kind: 'reply', id: m.id, value: r.value });
    } catch (e) {
      send(w, { kind: 'reply', id: m.id, error: e instanceof Error ? e.message : String(e) });
    }
  }, [print]);

  const spawn = useCallback((): Worker => {
    if (worker.current) return worker.current;
    const w = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<PythonWorkerMessage>) => {
      const m = e.data;
      if (m.kind === 'ready') {
        setVersion(m.version);
        // "Starting Python…" turns into running once the interpreter is ready.
        setPhase((p) => (p === 'loading' ? 'running' : p));
      }
      else if (m.kind === 'output') print(m.stream, m.text);
      else if (m.kind === 'io') void boardCall(m, w);
      else if (m.kind === 'done') finish.current?.(m.result);
    };
    w.onerror = (e) => {
      print('stderr', `Python could not start: ${e.message}`);
      finish.current?.({ outcome: 'error', message: `Python could not start: ${e.message}` });
    };
    worker.current = w;
    return w;
  }, [boardCall, print]);

  const end = useCallback(async (r: PythonResult) => {
    finish.current = null;
    // A finished program leaves the pins as they are; a stop or an error switches them off.
    if (connected.current) await window.studio.live.disconnect(r.outcome !== 'finished').catch(() => undefined);
    connected.current = false;
    if (r.outcome === 'error') print('stderr', r.traceback ?? r.message);
    print('info', r.outcome === 'finished' ? 'The program finished.' : r.outcome === 'stopped' ? 'Stopped.' : 'The program stopped with an error.');
    setResult(r);
    setPhase('idle');
  }, [print]);

  const run = useCallback(
    (code: string) => {
      if (finish.current) return;
      setResult(null);
      setLines([]);
      const w = spawn();
      setPhase(version ? 'running' : 'loading');
      if (!version) print('info', 'Starting Python…');
      finish.current = (r) => void end(r);
      send(w, { kind: 'run', code });
    },
    [spawn, end, print, version],
  );

  const stop = useCallback(() => {
    const w = worker.current;
    if (!w || !finish.current) return;
    setPhase('stopping');
    send(w, { kind: 'stop' });
    // A program that is busy computing (no wait or board call) cannot hear Stop: end its worker.
    const pendingFinish = finish.current;
    setTimeout(() => {
      if (finish.current !== pendingFinish) return;
      w.terminate();
      worker.current = null;
      setVersion(null);
      print('info', 'The program did not respond to Stop, so Python was restarted.');
      pendingFinish({ outcome: 'stopped', message: 'Stopped.' });
    }, STOP_GRACE_MS);
  }, [print]);

  /** Load the interpreter in the background (opening the Python view). */
  const preload = useCallback(() => send(spawn(), { kind: 'load' }), [spawn]);

  // Leaving the page must not leave motors running or a worker behind.
  useEffect(
    () => () => {
      worker.current?.terminate();
      if (connected.current) void window.studio.live.disconnect(true);
    },
    [],
  );

  return { phase, lines, result, version, run, stop, preload, clear: useCallback(() => setLines([]), []) };
}
