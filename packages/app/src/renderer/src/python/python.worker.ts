/// <reference lib="webworker" />
/**
 * Runs learners' Python (Pyodide) off the main thread, so a busy program never freezes the app.
 * Board commands are posted to the app, which owns the USB link; waits happen here.
 */
import { PYTHON_STOP, runPython, type PyodideLike, type PythonHostMessage, type PythonWorkerMessage } from '@tariro-studio/core';

declare const self: DedicatedWorkerGlobalScope;

const post = (m: PythonWorkerMessage) => self.postMessage(m);
let interpreter: Promise<PyodideLike> | undefined;
const pending = new Map<number, { resolve(v: number | null): void; reject(e: Error): void }>();
const timers = new Set<{ timer: ReturnType<typeof setTimeout>; reject(e: Error): void }>();
let nextId = 1;
let stopping = false;
const stopError = () => new Error(PYTHON_STOP);

/** Pyodide ships with the app (served from /pyodide/), so Python works offline. */
function load(): Promise<PyodideLike> {
  interpreter ??= (async () => {
    const base = new URL('/pyodide/', self.location.href).href;
    const mod = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as { loadPyodide(o: { indexURL: string }): Promise<unknown> };
    const py = (await mod.loadPyodide({ indexURL: base })) as PyodideLike;
    post({ kind: 'ready', version: String(py.runPython('import sys\nsys.version.split()[0]')) });
    return py;
  })();
  return interpreter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stopping) return reject(stopError());
    const entry = {
      timer: setTimeout(() => {
        timers.delete(entry);
        resolve();
      }, ms),
      reject,
    };
    timers.add(entry);
  });
}

self.onmessage = async (e: MessageEvent<PythonHostMessage>) => {
  const m = e.data;
  switch (m.kind) {
    case 'load':
      void load();
      return;
    case 'reply': {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p && m.error !== undefined) p.reject(new Error(m.error));
      else p?.resolve(m.value ?? null);
      return;
    }
    case 'stop':
      stopping = true;
      for (const t of timers) {
        clearTimeout(t.timer);
        t.reject(stopError());
      }
      timers.clear();
      for (const p of pending.values()) p.reject(stopError());
      pending.clear();
      return;
    case 'run': {
      stopping = false;
      const py = await load();
      const result = await runPython(py, m.code, {
        request: (op) =>
          stopping
            ? Promise.reject(stopError())
            : new Promise((resolve, reject) => {
                const id = nextId++;
                pending.set(id, { resolve, reject });
                post({ kind: 'io', id, op });
              }),
        sleep,
        output: (stream, text) => post({ kind: 'output', stream, text }),
        stopping: () => stopping,
      });
      post({ kind: 'done', result });
    }
  }
};
