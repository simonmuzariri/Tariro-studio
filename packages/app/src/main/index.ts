import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileNameFor, PRODUCT, validateEvent, type EventChannel, type EventPayload, type HandlerMap } from '@tariro-studio/core';
import { registerIpc } from './ipc-router.js';
import { APP_ORIGIN, registerAppSchemePrivileges, serveRendererFrom } from './app-protocol.js';
import { ToolchainService } from './services/toolchain.js';
import { SerialService } from './services/serial.js';
import { mockBackend, realBackend } from './services/backends.js';
import { arduinoConfigFile, findArduinoCli } from './services/cli-path.js';
import { ProjectService } from './services/projects.js';

const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;

// Development/test only: expose CDP so REA can inspect the UI (never in packaged builds).
const debugPort = process.env['TARIRO_STUDIO_REMOTE_DEBUG_PORT'];
if (!app.isPackaged && debugPort && /^\d{2,5}$/.test(debugPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
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
const useMockSerial = !app.isPackaged && process.env['TARIRO_SERIAL_MOCK'] === '1';

const serial = new SerialService(useMockSerial ? mockBackend() : realBackend, {
  ports: (e) => emit('serial:ports', e),
  data: (e) => emit('serial:data', e),
  state: (e) => emit('serial:state', e),
});

let toolchain: ToolchainService;
function createToolchain(): ToolchainService {
  const configFile = arduinoConfigFile(resourcesDir, app.getPath('userData'));
  return new ToolchainService({
    cliPath: findArduinoCli(resourcesDir),
    ...(configFile ? { configFile } : {}),
    workDir: join(app.getPath('userData'), 'build'),
    events: {
      log: (e) => emit('toolchain:log', e),
      progress: (e) => emit('toolchain:progress', e),
    },
    releasePort: (port) => serial.releaseForUpload(port),
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
  'project:export-sketch': async (code, name) => {
    const win = focusedWindow();
    const opts = { title: 'Export Arduino sketch', defaultPath: join(app.getPath('documents'), fileNameFor(name, '.ino')), filters: [{ name: 'Arduino sketch', extensions: ['ino'] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    try {
      return { path: projects.writeText(projects.grant(r.filePath), code) };
    } catch (err) {
      return failure(err);
    }
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
  'toolchain:status': (fqbn) => toolchain.status(fqbn),
  'toolchain:compile': (req) => toolchain.compile(req),
  'toolchain:upload': (req) => toolchain.upload(req),
  'toolchain:cancel': () => toolchain.cancel(),
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
    backgroundColor: '#f5f6fa',
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
  // Deny all permission prompts (camera, mic, geolocation…) until a feature needs one.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  serveRendererFrom(join(import.meta.dirname, '../renderer'));
  toolchain = createToolchain();
  projects = new ProjectService(app.getPath('userData'));
  projects.startSession();
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
  toolchain?.cancel();
  void serial.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
