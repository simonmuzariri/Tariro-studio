/**
 * Typed IPC contract between renderer (via preload) and main.
 *
 * Invoke channels (renderer → main → reply): main validates the arguments before running a
 * handler and validates the result before replying. Event channels (main → renderer): main
 * validates every payload before sending. The preload only forwards; the renderer gets static
 * types. Channels are added as milestones implement them — the contract never lists a channel
 * without a handler (`HandlerMap` makes that a compile error).
 */
import { z } from 'zod';
import { ProjectSchema, type Project } from './project.js';
import { DroneCommandSchema, DroneLinkStateSchema, type DroneCommand } from './drone/tello.js';

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.enum(['win32', 'linux', 'darwin', 'freebsd', 'openbsd', 'sunos', 'aix', 'android', 'haiku', 'cygwin', 'netbsd']),
  arch: z.string(),
  versions: z.object({
    electron: z.string(),
    chrome: z.string(),
    node: z.string(),
  }),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

// ───────────────────────── toolchain ─────────────────────────

const ProjectId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Fqbn = z.string().regex(/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+(:[A-Za-z0-9_.=,-]+)?$/);
const Code = z.string().max(2_000_000);

export const LibrarySchema = z.object({ name: z.string().min(1).max(120), version: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/) });
export const CompileRequestSchema = z.object({ code: Code, fqbn: Fqbn, projectId: ProjectId, libraries: z.array(LibrarySchema).max(64).optional() });
export const UploadRequestSchema = CompileRequestSchema.extend({ port: z.string().min(1).max(256) });
export type CompileRequest = z.infer<typeof CompileRequestSchema>;
export type UploadRequest = z.infer<typeof UploadRequestSchema>;

export const BuildPhaseSchema = z.enum(['idle', 'installing', 'compiling', 'uploading', 'done', 'error', 'cancelled']);
export const DiagnosticSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
});
export const SizesSchema = z.object({
  flash: z.number(),
  flashMax: z.number(),
  ram: z.number().optional(),
  ramMax: z.number().optional(),
});
export const BuildResultSchema = z.object({
  ok: z.boolean(),
  phase: BuildPhaseSchema,
  /** One-sentence, learner-friendly outcome. */
  message: z.string(),
  diagnostics: z.array(DiagnosticSchema),
  sizes: SizesSchema.optional(),
});
export type BuildResult = z.infer<typeof BuildResultSchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export type BuildSizes = z.infer<typeof SizesSchema>;

export const ToolchainStatusSchema = z.object({
  ready: z.boolean(),
  cliPath: z.string().nullable(),
  version: z.string().nullable(),
  platforms: z.array(z.string()),
  problem: z.string().optional(),
  /** Set when the only problem is board support that the app can install, e.g. "esp32:esp32". */
  missingPlatform: z.string().optional(),
});
export type ToolchainStatus = z.infer<typeof ToolchainStatusSchema>;

// ───────────────────────── serial ─────────────────────────

export const PortInfoSchema = z.object({
  path: z.string(),
  label: z.string(),
  vid: z.string().optional(),
  pid: z.string().optional(),
  manufacturer: z.string().optional(),
  serialNumber: z.string().optional(),
  suggestedBoardId: z.string().optional(),
});
export type PortInfo = z.infer<typeof PortInfoSchema>;

export const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000] as const;
const Baud = z.number().int().refine((b) => (BAUD_RATES as readonly number[]).includes(b), 'unsupported baud rate');
export const SerialStateSchema = z.object({
  open: z.boolean(),
  path: z.string().optional(),
  baud: z.number().optional(),
  error: z.string().optional(),
});
export type SerialState = z.infer<typeof SerialStateSchema>;

// ───────────────────────── live mode ─────────────────────────

const Pin = z.number().int().min(0).max(127);
/** One pin operation on the connected Firmata board. */
export const LiveOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('digitalWrite'), pin: Pin, on: z.boolean() }),
  z.object({ op: z.literal('analogWrite'), pin: Pin, value: z.number() }),
  z.object({ op: z.literal('servoWrite'), pin: Pin, angle: z.number() }),
  z.object({ op: z.literal('digitalRead'), pin: Pin, pullup: z.boolean() }),
  z.object({ op: z.literal('analogRead'), channel: z.number().int().min(0).max(15) }),
  z.object({ op: z.literal('analogPin'), channel: z.number().int().min(0).max(15) }),
]);
export type LiveOp = z.infer<typeof LiveOpSchema>;
export const LiveConnectResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** The port opened but no Firmata firmware answered: offer to install it. */
  needsFirmware: z.boolean(),
});
export type LiveConnectResult = z.infer<typeof LiveConnectResultSchema>;
export const LiveStateSchema = z.object({
  connected: z.boolean(),
  port: z.string().optional(),
  firmware: z.string().optional(),
  error: z.string().optional(),
  /** The emergency stop is latched: nothing drives the board until it is reset. */
  estop: z.boolean().optional(),
});
/** A command the safety layer limited or refused, or a watchdog / emergency-stop action. */
export const SafetyEventSchema = z.object({ kind: z.enum(['limited', 'blocked', 'watchdog', 'estop']), message: z.string().max(500) });
export type SafetyEvent = z.infer<typeof SafetyEventSchema>;
export type LiveState = z.infer<typeof LiveStateSchema>;

// ───────────────────────── projects ─────────────────────────

const FilePath = z.string().min(1).max(4096);
/** Uint8Array of any backing buffer (z.instanceof narrows to Uint8Array<ArrayBuffer>). */
const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'expected bytes');
const ThumbnailArea = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1).max(10_000), height: z.number().int().min(1).max(10_000) });
export type ThumbnailArea = z.infer<typeof ThumbnailArea>;

export const RecentProjectSchema = z.object({ path: z.string(), name: z.string(), modifiedAt: z.string() });
export const RecoverableProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  modifiedAt: z.string(),
  file: z.string(),
  savedPath: z.string().optional(),
});
export type RecentProject = z.infer<typeof RecentProjectSchema>;
export type RecoverableProject = z.infer<typeof RecoverableProjectSchema>;

export const OpenedProjectSchema = z.object({ path: z.string(), project: ProjectSchema, thumbnail: Bytes.optional() });
export type OpenedProject = z.infer<typeof OpenedProjectSchema>;
/** Errors cross IPC as results, so the renderer can show the friendly message as-is. */
const Failure = z.object({ error: z.string() });
const OrFailure = <T extends z.ZodType>(t: T) => z.union([t, Failure]);

// ───────────────────────── contract ─────────────────────────

export const ipcContract = {
  'app:version': { args: z.tuple([]), result: z.string().min(1) },
  'app:info': { args: z.tuple([]), result: AppInfoSchema },
  'toolchain:status': { args: z.tuple([z.string().optional()]), result: ToolchainStatusSchema },
  'toolchain:compile': { args: z.tuple([CompileRequestSchema]), result: BuildResultSchema },
  'toolchain:upload': { args: z.tuple([UploadRequestSchema]), result: BuildResultSchema },
  /** Download and install board support (a pinned core) for this board. Needs the internet. */
  'toolchain:install-platform': { args: z.tuple([Fqbn]), result: BuildResultSchema },
  'toolchain:cancel': { args: z.tuple([]), result: z.boolean() },
  /** Save a MicroPython program on the board as main.py and start it. */
  'micropython:upload': { args: z.tuple([z.object({ port: z.string().min(1).max(256), code: Code })]), result: BuildResultSchema },
  /** Open the port and wait for the Firmata firmware (live mode). Closes the Serial Monitor on that port. */
  'live:connect': { args: z.tuple([z.string().min(1).max(256)]), result: LiveConnectResultSchema },
  /** `reset` puts every pin back to its default first (outputs and motors off). */
  'live:disconnect': { args: z.tuple([z.boolean()]), result: z.boolean() },
  /** `value` is the reading for read operations, null otherwise. */
  'live:io': { args: z.tuple([LiveOpSchema]), result: z.union([z.object({ value: z.number().nullable() }), z.object({ error: z.string() })]) },
  /** Compile and upload the StandardFirmata firmware that live mode talks to. */
  /** The app is alive (sent twice a second); without it the safety watchdog switches the board off. */
  'live:heartbeat': { args: z.tuple([]), result: z.boolean() },
  /** Emergency stop: switch every pin off and refuse commands until reset. */
  'live:estop': { args: z.tuple([]), result: z.boolean() },
  'live:estop-reset': { args: z.tuple([]), result: z.boolean() },
  /** Safety settings for the board in use. */
  'live:safety': { args: z.tuple([z.object({ boardId: z.string().min(1).max(64), motorSpeedLimit: z.number().int().min(10).max(100) })]), result: z.boolean() },
  'live:install-firmware': { args: z.tuple([z.object({ port: z.string().min(1).max(256), fqbn: Fqbn })]), result: BuildResultSchema },
  /** Drone Studio, a real Tello over Wi-Fi: switch it into SDK mode and start the state stream. */
  'drone:connect': { args: z.tuple([]), result: z.object({ ok: z.boolean(), message: z.string() }) },
  /** Land it if flying, then close the link. */
  'drone:disconnect': { args: z.tuple([]), result: z.boolean() },
  /** One command, through the drone safety guard; resolves when the drone has done it. */
  'drone:command': { args: z.tuple([DroneCommandSchema]), result: z.union([z.object({ ok: z.literal(true) }), z.object({ error: z.string() })]) },
  /** Stop the command in progress and land where it is. */
  'drone:land-now': { args: z.tuple([]), result: z.boolean() },
  /** Cut the motors at once (the drone falls). */
  'drone:emergency': { args: z.tuple([]), result: z.boolean() },
  /** The app is alive; without it a flying drone is told to land. */
  'drone:heartbeat': { args: z.tuple([]), result: z.boolean() },
  'drone:limits': { args: z.tuple([z.object({ maxHeight: z.number().min(50).max(1000), fenceRadius: z.number().min(100).max(2000) })]), result: z.boolean() },
  'serial:list': { args: z.tuple([]), result: z.array(PortInfoSchema) },
  'serial:open': { args: z.tuple([z.string().min(1).max(256), Baud]), result: SerialStateSchema },
  'serial:close': { args: z.tuple([]), result: SerialStateSchema },
  'serial:write': { args: z.tuple([z.string().max(65_536)]), result: z.boolean() },
  'project:open-dialog': { args: z.tuple([]), result: OrFailure(OpenedProjectSchema).nullable() },
  'project:open': { args: z.tuple([FilePath]), result: OrFailure(OpenedProjectSchema) },
  /**
   * path null → "Save As" dialog. `thumbnailArea` is the workspace rectangle (CSS px) that main
   * captures as the project thumbnail. Result null = the learner cancelled the dialog.
   */
  'project:save': { args: z.tuple([FilePath.nullable(), ProjectSchema, ThumbnailArea.nullable()]), result: OrFailure(z.object({ path: z.string() })).nullable() },
  'project:autosave': { args: z.tuple([ProjectSchema]), result: z.boolean() },
  'project:recent': { args: z.tuple([]), result: z.array(RecentProjectSchema) },
  'project:recoverable': { args: z.tuple([]), result: z.array(RecoverableProjectSchema) },
  'project:recover': { args: z.tuple([z.string()]), result: OrFailure(ProjectSchema) },
  'project:dismiss-recovery': { args: z.tuple([]), result: z.boolean() },
  'project:export-sketch': { args: z.tuple([z.string().max(2_000_000), z.string().max(120), z.enum(['ino', 'py'])]), result: OrFailure(z.object({ path: z.string() })).nullable() },
  /** Window controls for our own title bar (the window has no native frame on Windows and Linux). */
  'window:minimize': { args: z.tuple([]), result: z.boolean() },
  /** Maximise, or restore if already maximised. Resolves to the new state. */
  'window:toggle-maximize': { args: z.tuple([]), result: z.boolean() },
  /** Ask the window to close; unsaved changes are still asked about first. */
  'window:close': { args: z.tuple([]), result: z.boolean() },
  'app:set-dirty': { args: z.tuple([z.boolean()]), result: z.boolean() },
  'app:confirm-close': { args: z.tuple([]), result: z.boolean() },
} as const;

/** Main → renderer push events. */
export const eventContract = {
  'toolchain:log': z.object({ line: z.string(), stream: z.enum(['stdout', 'stderr', 'info']) }),
  'toolchain:progress': z.object({ phase: BuildPhaseSchema, percent: z.number().min(0).max(100).optional() }),
  'serial:ports': z.array(PortInfoSchema),
  'serial:data': z.object({ data: z.string() }),
  'serial:state': SerialStateSchema,
  'live:state': LiveStateSchema,
  'live:safety': SafetyEventSchema,
  'drone:state': DroneLinkStateSchema,
  /** The OS asked us to open a .tsp (double-click, "Open with"). The path is already granted. */
  'project:open-request': z.object({ path: z.string() }),
  /** The window is closing with unsaved changes; the renderer asks the learner what to do. */
  'app:close-requested': z.object({}),
  'window:state': z.object({ maximized: z.boolean() }),
} as const;

export type Channel = keyof typeof ipcContract;
export type ArgsOf<C extends Channel> = z.infer<(typeof ipcContract)[C]['args']>;
export type ResultOf<C extends Channel> = z.infer<(typeof ipcContract)[C]['result']>;
export type Handler<C extends Channel> = (...args: ArgsOf<C>) => ResultOf<C> | Promise<ResultOf<C>>;
export type HandlerMap = { [C in Channel]: Handler<C> };

export type EventChannel = keyof typeof eventContract;
export type EventPayload<E extends EventChannel> = z.infer<(typeof eventContract)[E]>;

export const channels = Object.keys(ipcContract) as Channel[];
export const eventChannels = Object.keys(eventContract) as EventChannel[];

export class IpcValidationError extends Error {
  constructor(
    readonly channel: string,
    readonly direction: 'args' | 'result' | 'event',
    readonly issues: string,
  ) {
    super(`IPC ${direction} validation failed on "${channel}": ${issues}`);
    this.name = 'IpcValidationError';
  }
}

/** Validate args, run handler, validate result. Used by the main-process router. */
export async function dispatch<C extends Channel>(channel: C, handler: Handler<C>, rawArgs: unknown[]): Promise<ResultOf<C>> {
  const spec = ipcContract[channel];
  const parsedArgs = spec.args.safeParse(rawArgs);
  if (!parsedArgs.success) throw new IpcValidationError(channel, 'args', z.prettifyError(parsedArgs.error));
  const result = await handler(...(parsedArgs.data as ArgsOf<C>));
  const parsedResult = spec.result.safeParse(result);
  if (!parsedResult.success) throw new IpcValidationError(channel, 'result', z.prettifyError(parsedResult.error));
  return parsedResult.data as ResultOf<C>;
}

/** Validate an outgoing event payload. */
export function validateEvent<E extends EventChannel>(channel: E, payload: unknown): EventPayload<E> {
  const parsed = eventContract[channel].safeParse(payload);
  if (!parsed.success) throw new IpcValidationError(channel, 'event', z.prettifyError(parsed.error));
  return parsed.data as EventPayload<E>;
}

type Listener<E extends EventChannel> = (payload: EventPayload<E>) => void;
export type Unsubscribe = () => void;

/** The API the preload exposes on `window.studio`. */
export interface StudioBridge {
  app: {
    version(): Promise<string>;
    info(): Promise<AppInfo>;
  };
  toolchain: {
    status(fqbn?: string): Promise<ToolchainStatus>;
    compile(req: CompileRequest): Promise<BuildResult>;
    upload(req: UploadRequest): Promise<BuildResult>;
    cancel(): Promise<boolean>;
    installPlatform(fqbn: string): Promise<BuildResult>;
    uploadMicroPython(req: { port: string; code: string }): Promise<BuildResult>;
    onLog(cb: Listener<'toolchain:log'>): Unsubscribe;
    onProgress(cb: Listener<'toolchain:progress'>): Unsubscribe;
  };
  project: {
    openDialog(): Promise<OpenedProject | { error: string } | null>;
    open(path: string): Promise<OpenedProject | { error: string }>;
    save(path: string | null, project: Project, thumbnailArea: ThumbnailArea | null): Promise<{ path: string } | { error: string } | null>;
    autosave(project: Project): Promise<boolean>;
    recent(): Promise<RecentProject[]>;
    recoverable(): Promise<RecoverableProject[]>;
    recover(id: string): Promise<Project | { error: string }>;
    dismissRecovery(): Promise<boolean>;
    exportSketch(code: string, projectName: string, kind: 'ino' | 'py'): Promise<{ path: string } | { error: string } | null>;
    onOpenRequest(cb: Listener<'project:open-request'>): Unsubscribe;
  };
  window: {
    setDirty(dirty: boolean): Promise<boolean>;
    confirmClose(): Promise<boolean>;
    onCloseRequested(cb: Listener<'app:close-requested'>): Unsubscribe;
    minimize(): Promise<boolean>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<boolean>;
    onState(cb: Listener<'window:state'>): Unsubscribe;
  };
  live: {
    connect(port: string): Promise<LiveConnectResult>;
    disconnect(reset: boolean): Promise<boolean>;
    io(op: LiveOp): Promise<{ value: number | null } | { error: string }>;
    installFirmware(req: { port: string; fqbn: string }): Promise<BuildResult>;
    heartbeat(): Promise<boolean>;
    emergencyStop(): Promise<boolean>;
    resetEmergencyStop(): Promise<boolean>;
    setSafety(s: { boardId: string; motorSpeedLimit: number }): Promise<boolean>;
    onState(cb: Listener<'live:state'>): Unsubscribe;
    onSafety(cb: Listener<'live:safety'>): Unsubscribe;
  };
  drone: {
    connect(): Promise<{ ok: boolean; message: string }>;
    disconnect(): Promise<boolean>;
    command(c: DroneCommand): Promise<{ ok: true } | { error: string }>;
    landNow(): Promise<boolean>;
    emergency(): Promise<boolean>;
    heartbeat(): Promise<boolean>;
    setLimits(l: { maxHeight: number; fenceRadius: number }): Promise<boolean>;
    onState(cb: Listener<'drone:state'>): Unsubscribe;
  };
  serial: {
    list(): Promise<PortInfo[]>;
    open(path: string, baud: number): Promise<SerialState>;
    close(): Promise<SerialState>;
    write(data: string): Promise<boolean>;
    onPorts(cb: Listener<'serial:ports'>): Unsubscribe;
    onData(cb: Listener<'serial:data'>): Unsubscribe;
    onState(cb: Listener<'serial:state'>): Unsubscribe;
  };
}
