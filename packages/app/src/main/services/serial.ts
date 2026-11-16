/**
 * USB serial ports: hot-plug watching with board recognition, and one Serial Monitor connection.
 * The port backend is injected (real `serialport` or its mock binding), so this runs in Node tests.
 */
import { suggestBoard, BOARDS, type EventPayload, type PortInfo, type SerialState } from '@tariro-studio/core';

export interface RawPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  pnpId?: string;
}

/** The subset of a SerialPort instance this service uses. */
export interface PortHandle {
  isOpen: boolean;
  on(event: 'data', cb: (chunk: Buffer) => void): unknown;
  on(event: 'close', cb: (err?: Error | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  write(data: string | Uint8Array, cb?: (err: Error | null | undefined) => void): boolean;
  close(cb?: (err?: Error | null) => void): void;
}

export interface PortBackend {
  list(): Promise<RawPort[]>;
  open(path: string, baud: number): Promise<PortHandle>;
}

export interface SerialEvents {
  ports(e: EventPayload<'serial:ports'>): void;
  data(e: EventPayload<'serial:data'>): void;
  state(e: EventPayload<'serial:state'>): void;
}

/** Hide built-in UART/Bluetooth placeholders that are never a kit board. */
function isLikelyBoard(p: RawPort): boolean {
  if (p.vendorId) return true;
  return /ttyUSB|ttyACM|cu\.usb|tty\.usb|^COM\d+$/i.test(p.path);
}

export function describePort(p: RawPort): PortInfo {
  const suggested = suggestBoard(p.vendorId, p.productId);
  const board = suggested ? BOARDS.find((b) => b.id === suggested) : undefined;
  const who = board?.name ?? p.manufacturer;
  const info: PortInfo = { path: p.path, label: who ? `${p.path} — ${who}` : p.path };
  if (p.vendorId) info.vid = p.vendorId.toLowerCase();
  if (p.productId) info.pid = p.productId.toLowerCase();
  if (p.manufacturer) info.manufacturer = p.manufacturer;
  if (p.serialNumber) info.serialNumber = p.serialNumber;
  if (suggested) info.suggestedBoardId = suggested;
  return info;
}

export class SerialService {
  private port: PortHandle | undefined;
  private state: SerialState = { open: false };
  private ports: PortInfo[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private decoder = new TextDecoder();

  constructor(
    private readonly backend: PortBackend,
    private readonly events: SerialEvents,
  ) {}

  /** Poll for plugged/unplugged boards; emits `serial:ports` only when the list changes. */
  startWatching(intervalMs = 1500): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  stopWatching(): void {
    clearInterval(this.timer);
  }

  async refresh(): Promise<PortInfo[]> {
    let raw: RawPort[];
    try {
      raw = await this.backend.list();
    } catch {
      raw = [];
    }
    const next = raw.filter(isLikelyBoard).map(describePort).sort((a, b) => a.path.localeCompare(b.path));
    if (JSON.stringify(next) !== JSON.stringify(this.ports)) {
      this.ports = next;
      this.events.ports(next);
      // The monitor's board was unplugged.
      if (this.state.open && this.state.path && !next.some((p) => p.path === this.state.path)) {
        this.port = undefined;
        this.setState({ open: false, path: this.state.path, error: 'The board was disconnected.' });
      }
    }
    return next;
  }

  list(): PortInfo[] {
    return this.ports;
  }

  async open(path: string, baud: number): Promise<SerialState> {
    await this.close();
    try {
      const port = await this.backend.open(path, baud);
      this.port = port;
      this.decoder = new TextDecoder();
      port.on('data', (chunk) => this.events.data({ data: this.decoder.decode(chunk, { stream: true }) }));
      port.on('error', (err) => this.setState({ open: port.isOpen, path, baud, error: friendly(err) }));
      port.on('close', (err) => {
        if (this.port === port) this.port = undefined;
        this.setState(err ? { open: false, path, baud, error: friendly(err) } : { open: false, path, baud });
      });
      return this.setState({ open: true, path, baud });
    } catch (err) {
      return this.setState({ open: false, path, baud, error: friendly(err as Error) });
    }
  }

  async close(): Promise<SerialState> {
    const port = this.port;
    this.port = undefined;
    if (port?.isOpen) await new Promise<void>((resolve) => port.close(() => resolve()));
    return this.setState({ open: false, ...(this.state.path ? { path: this.state.path } : {}), ...(this.state.baud ? { baud: this.state.baud } : {}) });
  }

  async write(data: string): Promise<boolean> {
    const port = this.port;
    if (!port?.isOpen) return false;
    return new Promise((resolve) => port.write(data, (err) => resolve(!err)));
  }

  /** Free the port for an upload; the returned function reopens the monitor if it was open. */
  async releaseForUpload(path: string): Promise<() => Promise<void>> {
    const { open, path: openPath, baud } = this.state;
    if (!open || openPath !== path || !baud) return async () => {};
    await this.close();
    return async () => {
      // Boards reset after upload; give the USB-serial chip a moment before reconnecting.
      await new Promise((r) => setTimeout(r, 400));
      await this.open(path, baud);
    };
  }

  private setState(s: SerialState): SerialState {
    this.state = s;
    this.events.state(s);
    return s;
  }
}

function friendly(err: Error): string {
  const m = err.message ?? String(err);
  if (/permission denied|EACCES/i.test(m))
    return 'Permission denied. On Linux, add your user to the "dialout" group and log in again.';
  if (/busy|EBUSY|resource temporarily unavailable/i.test(m)) return 'The port is in use by another program.';
  if (/no such file|ENOENT|cannot open/i.test(m)) return 'The port is no longer available. Reconnect the board.';
  return m;
}
