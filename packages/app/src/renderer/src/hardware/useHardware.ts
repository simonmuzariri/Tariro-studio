import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuildResult, EventPayload, PortInfo, SerialState, ToolchainStatus } from '@tariro-studio/core';

const MAX_LOG_LINES = 2000;
const MAX_SERIAL_CHARS = 200_000;

export type LogLine = EventPayload<'toolchain:log'> & { id: number };

/** Toolchain state: status, compile/upload jobs, progress and the Output log. */
export function useToolchain(fqbn: string) {
  const [status, setStatus] = useState<ToolchainStatus | null>(null);
  const [progress, setProgress] = useState<EventPayload<'toolchain:progress'>>({ phase: 'idle' });
  const [busy, setBusy] = useState<false | 'compile' | 'upload'>(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    let alive = true;
    window.studio.toolchain.status(fqbn).then((s) => alive && setStatus(s), () => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, [fqbn]);

  useEffect(() => {
    const offLog = window.studio.toolchain.onLog((e) =>
      setLog((prev) => [...prev, { ...e, id: nextId.current++ }].slice(-MAX_LOG_LINES)),
    );
    const offProgress = window.studio.toolchain.onProgress(setProgress);
    return () => {
      offLog();
      offProgress();
    };
  }, []);

  const run = useCallback(async (kind: 'compile' | 'upload', job: () => Promise<BuildResult>) => {
    setBusy(kind);
    setResult(null);
    try {
      const r = await job();
      setResult(r);
      return r;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    progress,
    busy,
    result,
    log,
    clearLog: () => setLog([]),
    compile: (code: string, projectId: string, libraries: Array<{ name: string; version: string }>) =>
      run('compile', () => window.studio.toolchain.compile({ code, fqbn, projectId, libraries })),
    upload: (code: string, projectId: string, port: string, libraries: Array<{ name: string; version: string }>) =>
      run('upload', () => window.studio.toolchain.upload({ code, fqbn, projectId, port, libraries })),
    cancel: () => window.studio.toolchain.cancel(),
  };
}

/** USB ports and the Serial Monitor connection. */
export function useSerial() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [state, setState] = useState<SerialState>({ open: false });
  const [text, setText] = useState('');

  useEffect(() => {
    window.studio.serial.list().then(setPorts, () => setPorts([]));
    const offPorts = window.studio.serial.onPorts(setPorts);
    const offState = window.studio.serial.onState(setState);
    const offData = window.studio.serial.onData((d) => setText((prev) => (prev + d.data).slice(-MAX_SERIAL_CHARS)));
    return () => {
      offPorts();
      offState();
      offData();
    };
  }, []);

  return {
    ports,
    state,
    text,
    clear: () => setText(''),
    open: (path: string, baud: number) => window.studio.serial.open(path, baud),
    close: () => window.studio.serial.close(),
    write: (data: string) => window.studio.serial.write(data),
  };
}
