import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BOARDS, fileNameFor, PRODUCT, validateEvent, type EventChannel, type EventPayload, type HandlerMap } from '@tariro-studio/core';
import { registerIpc } from './ipc-router.js';
import { APP_ORIGIN, registerAppSchemePrivileges, serveRendererFrom } from './app-protocol.js';
import { ToolchainService } from './services/toolchain.js';
import { SerialService } from './services/serial.js';
import { mockBackend, realBackend } from './services/backends.js';
import { findArduinoCli, prepareArduinoHome } from './services/cli-path.js';
import { ProjectService } from './services/projects.js';
import { MicroPythonService } from './services/micropython.js';
import { LiveService } from './services/live.js';
import { REAL_TELLO, TelloService } from './services/tello.js';
import { FakeTello } from './services/fake-tello.js';

const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;

// Development/test only: expose CDP so REA can inspect the UI (never in packaged builds).
const debugPort = process.env['TARIRO_STUDIO_REMOTE_DEBUG_PORT'];
if (!app.isPackaged && debugPort && /^\d{2,5}$/.test(debugPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
}

// Tests only: a built-in fake camera instead of a real one (never in packaged builds).
if (!app.isPackaged && process.env['TARIRO_FAKE_CAMERA'] === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
}

app.setName(PRODUCT.name);
registerAppSchemePrivileges();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const isTrustedSender = (url: string): boolean =>
  url.startsWith(`${APP_ORIGIN}/`) || (devServerUrl !== undefined && url.startsWith(devServerUrl));

/** Validate and push an event to every window. */
function emit<E extends EventChannel>(channel: E, payload: EventPayload<E>): void {
  const valid = validateEvent(channel, payload);
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, valid);
}

// Resources: packaged → process.resourcesPath; development → <repo>/resources.
const resourcesDir = app.isPackaged ? process.resourcesPath : join(import.meta.dirname, '../../../../resources');
// Development/test only: '1' = a port that echoes, 'firmata' = a simulated live-mode board.
const mockSerial = app.isPackaged ? undefined : process.env['TARIRO_SERIAL_MOCK'];

const portBackend =
  mockSerial === 'firmata'
    ? mockBackend('firmata', (line) => emit('toolchain:log', { line: `[simulated board] ${line}`, stream: 'info' }))
    : mockSerial === '1'
      ? mockBackend('echo')
      : realBackend;
const serial = new SerialService(portBackend, {
  ports: (e) => emit('serial:ports', e),
  data: (e) => emit('serial:data', e),
  state: (e) => emit('serial:state', e),
});

const micropython = new MicroPythonService(portBackend, {
  log: (e) => emit('toolchain:log', e),
  progress: (e) => emit('toolchain:progress', e),
});

const live = new LiveService(portBackend, { state: (e) => emit('live:state', e), safety: (e) => emit('live:safety', e) });
// The safety watchdog: if the app stops sending heartbeats while a board is driven, switch it off.
setInterval(() => void live.checkWatchdog(), 250).unref();
// Drone Studio's link to a real Tello. Development/test only: TARIRO_FAKE_TELLO=1 flies a pretend
// Tello on this computer (the simulator behind the real protocol) instead.
const fakeTello = !app.isPackaged && process.env['TARIRO_FAKE_TELLO'] === '1' ? new FakeTello(18889, 18890) : undefined;
const fakeTelloReady = fakeTello?.start();
const tello = new TelloService(fakeTello ? { host: '127.0.0.1', port: 18889, statePort: 18890 } : REAL_TELLO, (s) => emit('drone:state', s));
// If the app stops sending heartbeats while the drone flies, land it.
setInterval(() => tello.checkWatchdog(), 250).unref();

/** Reopens the Serial Monitor that live mode took the port from. */
let reopenMonitor: (() => Promise<void>) | undefined;

/**
 * Resolves once the bundled toolchain is in place (a first start copies it into the user's data
 * folder, which takes a few seconds). Everything that needs arduino-cli awaits this.
 */
let toolchainReady: Promise<ToolchainService>;
async function createToolchain(): Promise<ToolchainService> {
  let configFile: string | undefined;
  try {
    // Development uses the machine's own arduino-cli setup unless TARIRO_USE_BUNDLE=1 asks for the bundle.
    const useBundle = app.isPackaged || process.env['TARIRO_USE_BUNDLE'] === '1';
    configFile = await prepareArduinoHome(resourcesDir, app.getPath('userData'), (line) => emit('toolchain:log', { line, stream: 'info' }), useBundle);
  } catch (err) {
    emit('toolchain:log', { line: `The bundled Arduino toolchain could not be prepared: ${(err as Error).message}`, stream: 'stderr' });
  }
  return new ToolchainService({
    cliPath: findArduinoCli(resourcesDir),
    ...(configFile ? { configFile } : {}),
    workDir: join(app.getPath('userData'), 'build'),
    events: {
      log: (e) => emit('toolchain:log', e),
      progress: (e) => emit('toolchain:progress', e),
    },
    releasePort: async (port) => {
      // An upload ends live mode on that port.
      if (live.connectedPort === port) await live.disconnect(false);
      return serial.releaseForUpload(port);
    },
  });
}

let projects: ProjectService;
/** Unsaved changes in the renderer (it tells us); the window asks before closing. */
let dirty = false;
let allowClose = false;

const TSP_FILTER = [{ name: 'Tariro Studio project', extensions: ['tsp'] }];
const failure = (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) });
const focusedWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

/** .tsp paths handed to us by the OS ("Open with", double-click, second instance). */
const tspArgs = (argv: string[]) => argv.filter((a) => a.toLowerCase().endsWith('.tsp') && existsSync(a));
const pendingOpen: string[] = app.isPackaged ? tspArgs(process.argv.slice(1)) : [];
function requestOpen(path: string) {
  emit('project:open-request', { path: projects.grant(path) });
}

/** Screenshot of the block workspace, scaled to at most 480 px wide, for the project thumbnail. */
async function captureThumbnail(area: { x: number; y: number; width: number; height: number }): Promise<Uint8Array | undefined> {
  try {
    const image = await focusedWindow()?.webContents.capturePage(area);
    if (!image || image.isEmpty()) return undefined;
    const scaled = image.getSize().width > 480 ? image.resize({ width: 480, quality: 'good' }) : image;
    return new Uint8Array(scaled.toPNG());
  } catch {
    return undefined; // a missing thumbnail never blocks saving
  }
}

const handlers: HandlerMap = {
  'project:open-dialog': async () => {
    const win = focusedWindow();
    const opts = { title: 'Open project', filters: TSP_FILTER, properties: ['openFile' as const] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = r.filePaths[0];
    if (r.canceled || !file) return null;
    try {
      return projects.open(projects.grant(file));
    } catch (err) {
      return failure(err);
    }
  },
  'project:open': (path) => {
    try {
      return projects.open(path);
    } catch (err) {
      return failure(err);
    }
  },
  'project:save': async (path, project, area) => {
    const thumbnail = area ? await captureThumbnail(area) : undefined;
    let target = path;
    if (!target) {
      const win = focusedWindow();
      const opts = { title: 'Save project', defaultPath: join(app.getPath('documents'), fileNameFor(project.name, '.tsp')), filters: TSP_FILTER };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      target = projects.grant(r.filePath.toLowerCase().endsWith('.tsp') ? r.filePath : `${r.filePath}.tsp`);
    }
    try {
      return { path: projects.save(target, project, thumbnail) };
    } catch (err) {
      return failure(err);
    }
  },
  'project:autosave': (project) => {
    projects.autosave(project);
    return true;
  },
  'project:recent': () => projects.recent(),
  'project:recoverable': () => projects.listRecoverable(),
  'project:recover': (id) => {
    try {
      return projects.recover(id);
    } catch (err) {
      return failure(err);
    }
  },
  'project:dismiss-recovery': () => {
    projects.dismissRecovery();
    return true;
  },
  'project:export-sketch': async (code, name, kind) => {
    const win = focusedWindow();
    const opts =
      kind === 'py'
        ? { title: 'Export MicroPython program', defaultPath: join(app.getPath('documents'), fileNameFor(name, '.py')), filters: [{ name: 'Python', extensions: ['py'] }] }
        : { title: 'Export Arduino sketch', defaultPath: join(app.getPath('documents'), fileNameFor(name, '.ino')), filters: [{ name: 'Arduino sketch', extensions: ['ino'] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    try {
      return { path: projects.writeText(projects.grant(r.filePath), code) };
    } catch (err) {
      return failure(err);
    }
  },
  'window:minimize': () => {
    focusedWindow()?.minimize();
    return true;
  },
  'window:toggle-maximize': () => {
    const win = focusedWindow();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  },
  'window:close': () => {
    // Goes through the normal 'close' event, so unsaved changes are still asked about.
    focusedWindow()?.close();
    return true;
  },
  'app:set-dirty': (value) => {
    dirty = value;
    return true;
  },
  'app:confirm-close': () => {
    allowClose = true;
    focusedWindow()?.close();
    return true;
  },
  'toolchain:status': async (fqbn) => (await toolchainReady).status(fqbn),
  'toolchain:compile': async (req) => (await toolchainReady).compile(req),
  'toolchain:upload': async (req) => (await toolchainReady).upload(req),
  'toolchain:install-platform': async (fqbn) => (await toolchainReady).installPlatform(fqbn),
  'toolchain:cancel': async () => (await toolchainReady).cancel(),
  'micropython:upload': async ({ port, code }) => {
    // The Serial Monitor shares the port: free it for the upload, then reconnect.
    const reopen = await serial.releaseForUpload(port);
    try {
      return await micropython.upload(port, code);
    } finally {
      await reopen();
    }
  },
  'live:connect': async (port) => {
    reopenMonitor = await serial.releaseForUpload(port);
    const r = await live.connect(port);
    if (!r.ok) {
      await reopenMonitor();
      reopenMonitor = undefined;
    }
    return r;
  },
  'live:disconnect': async (reset) => {
    const was = await live.disconnect(reset);
    await reopenMonitor?.();
    reopenMonitor = undefined;
    return was;
  },
  'live:io': (op) => live.io(op),
  'drone:connect': async () => {
    await fakeTelloReady;
    return tello.connect();
  },
  'drone:disconnect': () => tello.disconnect(),
  'drone:command': (c) => tello.command(c),
  'drone:land-now': () => tello.landNow(),
  'drone:emergency': () => tello.emergency(),
  'drone:heartbeat': () => {
    tello.heartbeat();
    return true;
  },
  'drone:limits': (limits) => {
    tello.setLimits(limits);
    return true;
  },
  'live:heartbeat': () => {
    live.heartbeat();
    return true;
  },
  'live:estop': async () => {
    await live.emergencyStop();
    await reopenMonitor?.();
    reopenMonitor = undefined;
    return true;
  },
  'live:estop-reset': () => {
    live.resetEmergencyStop();
    return true;
  },
  'live:safety': ({ boardId, motorSpeedLimit }) => {
    live.configureSafety(BOARDS.find((b) => b.id === boardId), { motorSpeedLimit });
    return true;
  },
  'live:install-firmware': async ({ port, fqbn }) => {
    await live.disconnect(false);
    return (await toolchainReady).uploadLibraryExample({
      fqbn,
      port,
      projectId: 'live-firmware',
      library: { name: 'Firmata', version: '2.5.9' },
      example: 'StandardFirmata',
      libraries: [{ name: 'Servo', version: '1.3.0' }],
    });
  },
  'serial:list': () => serial.refresh(),
  'serial:open': (path, baud) => serial.open(path, baud),
  'serial:close': () => serial.close(),
  'serial:write': (data) => serial.write(data),
  'app:version': () => app.getVersion(),
  'app:info': () => ({
    name: PRODUCT.name,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }),
};

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: PRODUCT.name,
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    // The app draws its own title bar. macOS keeps its traffic lights; elsewhere the window has
    // no native frame and the title bar provides minimise / maximise / close.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : { frame: false }),
    backgroundColor: '#111111',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  const sendState = () => emit('window:state', { maximized: win.isMaximized() });
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);

  // Unsaved changes: let the renderer ask Save / Don't save / Cancel.
  win.on('close', (e) => {
    if (dirty && !allowClose) {
      e.preventDefault();
      emit('app:close-requested', {});
    }
  });

  // Deliver .tsp files the OS asked us to open once the UI can receive them.
  win.webContents.once('did-finish-load', () => {
    for (const p of pendingOpen.splice(0)) requestOpen(p);
  });

  // The UI never navigates away or opens windows; external links go to the OS browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) void win.loadURL(devServerUrl);
  else void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

app.on('open-file', (e, path) => {
  // macOS "Open with" / double-click.
  e.preventDefault();
  if (projects && BrowserWindow.getAllWindows().length) requestOpen(path);
  else pendingOpen.push(path);
});

app.on('second-instance', (_e, argv) => {
  for (const p of tspArgs(argv)) requestOpen(p);
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  // Only the camera is ever allowed, and only for the app's own pages: the AI tools ask the
  // learner first (in the app) and then open the camera. Microphone, location, notifications and
  // everything else stay denied.
  const cameraOnly = (perm: string, url: string, mediaTypes?: readonly string[]) =>
    perm === 'media' && isTrustedSender(url) && (mediaTypes === undefined || (mediaTypes.length > 0 && mediaTypes.every((t) => t === 'video')));
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) =>
    cb(cameraOnly(perm, details.requestingUrl, 'mediaTypes' in details ? details.mediaTypes : undefined)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, perm, origin, details) =>
    perm === 'media' && (details as { mediaType?: string }).mediaType === 'video' && isTrustedSender(`${origin.replace(/\/$/, '')}/`),
  );
  serveRendererFrom(join(import.meta.dirname, '../renderer'));
  toolchainReady = createToolchain();
  projects = new ProjectService(app.getPath('userData'));
  projects.startSession();
  // The app has its own menus and shortcuts; Electron's default menu would also bind Ctrl+R to
  // "reload", which is our Verify. macOS keeps the system menu for copy/paste and quit.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  registerIpc(handlers, isTrustedSender);
  serial.startWatching();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  projects?.markCleanExit();
  serial.stopWatching();
  void toolchainReady?.then((t) => t.cancel());
  void serial.close();
  void live.disconnect(true);
  void tello.disconnect();
  fakeTello?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
