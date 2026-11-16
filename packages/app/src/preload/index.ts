import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ArgsOf, Channel, EventChannel, EventPayload, ResultOf, StudioBridge } from '@tariro-studio/core';

// Type-only imports from core: this file must bundle to a single CJS file that requires
// nothing but 'electron' (sandboxed preload). Validation happens in main.
const invoke = <C extends Channel>(channel: C, ...args: ArgsOf<C>): Promise<ResultOf<C>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<ResultOf<C>>;

/** Subscribe to one main → renderer event; the Electron event object never reaches the page. */
const on =
  <E extends EventChannel>(channel: E) =>
  (cb: (payload: EventPayload<E>) => void) => {
    const listener = (_e: IpcRendererEvent, payload: EventPayload<E>) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

const api: StudioBridge = {
  app: {
    version: () => invoke('app:version'),
    info: () => invoke('app:info'),
  },
  toolchain: {
    status: (fqbn) => invoke('toolchain:status', fqbn),
    compile: (req) => invoke('toolchain:compile', req),
    upload: (req) => invoke('toolchain:upload', req),
    cancel: () => invoke('toolchain:cancel'),
    onLog: on('toolchain:log'),
    onProgress: on('toolchain:progress'),
  },
  project: {
    openDialog: () => invoke('project:open-dialog'),
    open: (path) => invoke('project:open', path),
    save: (path, project, area) => invoke('project:save', path, project, area),
    autosave: (project) => invoke('project:autosave', project),
    recent: () => invoke('project:recent'),
    recoverable: () => invoke('project:recoverable'),
    recover: (id) => invoke('project:recover', id),
    dismissRecovery: () => invoke('project:dismiss-recovery'),
    exportSketch: (code, name) => invoke('project:export-sketch', code, name),
    onOpenRequest: on('project:open-request'),
  },
  window: {
    setDirty: (dirty) => invoke('app:set-dirty', dirty),
    confirmClose: () => invoke('app:confirm-close'),
    onCloseRequested: on('app:close-requested'),
  },
  serial: {
    list: () => invoke('serial:list'),
    open: (path, baud) => invoke('serial:open', path, baud),
    close: () => invoke('serial:close'),
    write: (data) => invoke('serial:write', data),
    onPorts: on('serial:ports'),
    onData: on('serial:data'),
    onState: on('serial:state'),
  },
};

contextBridge.exposeInMainWorld('studio', api);
