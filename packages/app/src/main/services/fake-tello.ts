/**
 * A pretend DJI Tello for tests and development (TARIRO_FAKE_TELLO=1): it speaks the Tello's text
 * protocol over UDP on localhost and flies the Drone Studio simulator in real time, answering "ok"
 * when a command is done and broadcasting its state ten times a second, like the real drone.
 */
import dgram from 'node:dgram';
import { DroneSim, type DroneFlip, type DroneMove } from '@tariro-studio/core';

const FLIPS: Record<string, DroneFlip> = { f: 'forward', b: 'back', l: 'left', r: 'right' };

export class FakeTello {
  readonly sim = new DroneSim({ maxHeight: 1000, fenceRadius: 2000 }, 90);
  private socket = dgram.createSocket('udp4');
  private timers: NodeJS.Timeout[] = [];
  private client: { address: string; port: number } | undefined;
  private sdk = false;
  /** Every command it received, for tests. */
  readonly received: string[] = [];

  constructor(
    readonly port: number,
    private readonly statePort: number,
    private readonly host = '127.0.0.1',
  ) {}

  start(): Promise<void> {
    // A Tello starts at 10 cm/s until told otherwise.
    void this.sim.setSpeed(10);
    this.socket.on('message', (msg, rinfo) => {
      this.client = { address: rinfo.address, port: rinfo.port };
      void this.handle(msg.toString('utf8').trim());
    });
    let last = Date.now();
    this.timers.push(
      setInterval(() => {
        const now = Date.now();
        this.sim.step(now - last);
        last = now;
      }, 20),
      setInterval(() => this.broadcast(), 100),
    );
    for (const t of this.timers) t.unref();
    return new Promise((resolve) => this.socket.bind(this.port, this.host, () => resolve()));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
  }

  private reply(text: string): void {
    if (this.client) this.socket.send(text, this.client.port, this.client.address);
  }

  private async handle(text: string): Promise<void> {
    this.received.push(text);
    const [word, arg] = text.split(/\s+/);
    if (word === 'command') {
      this.sdk = true;
      return this.reply('ok');
    }
    if (!this.sdk) return; // a real Tello ignores everything until "command"
    if (word === 'battery?') return this.reply(String(Math.round(this.sim.state().battery)));
    if (word === 'stop') {
      this.sim.cancel();
      return this.reply('ok');
    }
    if (word === 'emergency') {
      void this.sim.emergency();
      return this.reply('ok');
    }
    const n = Number(arg);
    let run: Promise<void> | undefined;
    if (word === 'takeoff') run = this.sim.takeoff();
    else if (word === 'land') run = this.sim.land();
    else if (['up', 'down', 'left', 'right', 'forward', 'back'].includes(word!)) run = this.sim.move(word as DroneMove, n);
    else if (word === 'cw' || word === 'ccw') run = this.sim.turn(word === 'cw' ? 'right' : 'left', n);
    else if (word === 'flip' && FLIPS[arg ?? '']) run = this.sim.flip(FLIPS[arg!]!);
    else if (word === 'speed') run = this.sim.setSpeed(n);
    if (!run) return this.reply('error Not joystick');
    try {
      await run;
      this.reply('ok');
    } catch (e) {
      this.reply(`error ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private broadcast(): void {
    const s = this.sim.state();
    const yaw = Math.round(s.heading > 180 ? s.heading - 360 : s.heading);
    const text = `pitch:${Math.round(s.pitch)};roll:${Math.round(s.roll)};yaw:${yaw};vgx:0;vgy:0;vgz:0;templ:60;temph:62;tof:${Math.round(s.z + 10)};h:${Math.round(s.z)};bat:${Math.round(s.battery)};baro:0.00;time:${Math.round(s.flightTime)};agx:0.00;agy:0.00;agz:-1000.00;\r\n`;
    this.socket.send(text, this.statePort, this.host);
  }
}
