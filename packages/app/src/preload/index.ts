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
    installPlatform: (fqbn) => invoke('toolchain:install-platform', fqbn),
    uploadMicroPython: (req) => invoke('micropython:upload', req),
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
    exportSketch: (code, name, kind) => invoke('project:export-sketch', code, name, kind),
    onOpenRequest: on('project:open-request'),
  },
  window: {
    setDirty: (dirty) => invoke('app:set-dirty', dirty),
    confirmClose: () => invoke('app:confirm-close'),
    onCloseRequested: on('app:close-requested'),
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize'),
    close: () => invoke('window:close'),
    onState: on('window:state'),
  },
  live: {
    connect: (port) => invoke('live:connect', port),
    disconnect: (reset) => invoke('live:disconnect', reset),
    io: (op) => invoke('live:io', op),
    installFirmware: (req) => invoke('live:install-firmware', req),
    heartbeat: () => invoke('live:heartbeat'),
    emergencyStop: () => invoke('live:estop'),
    resetEmergencyStop: () => invoke('live:estop-reset'),
    setSafety: (s) => invoke('live:safety', s),
    onState: on('live:state'),
    onSafety: on('live:safety'),
  },
  drone: {
    connect: () => invoke('drone:connect'),
    disconnect: () => invoke('drone:disconnect'),
    command: (c) => invoke('drone:command', c),
    landNow: () => invoke('drone:land-now'),
    emergency: () => invoke('drone:emergency'),
    heartbeat: () => invoke('drone:heartbeat'),
    setLimits: (l) => invoke('drone:limits', l),
    onState: on('drone:state'),
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
