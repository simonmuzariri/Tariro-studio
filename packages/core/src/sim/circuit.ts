/**
 * The Simulation Lab's circuit model: parts joined at named nodes, a 5 V microcontroller board
 * whose pins drive or sense those nodes, and a simulator that solves the circuit each time a
 * pin or an input changes.
 *
 * The simulator implements `LiveBoard`, the same interface the Firmata connection implements.
 * A block program therefore runs unchanged against the virtual circuit: when it writes a pin,
 * the solver decides what the LED on that pin does. Nothing is animated independently of the
 * program.
 *
 * Scope of this first version: 5 V AVR boards (Uno-type and Mega), DC behaviour only, PWM as an
 * average voltage. See `solver.ts` for what the electrical model leaves out.
 */
import type { BoardDefinition } from '../types.js';
import type { LiveBoard } from '../live/firmata.js';
import { GROUND, ledModel, solve, type Element } from './solver.js';

export const SUPPLY = '5V';
export const SUPPLY_VOLTS = 5;
/** Output resistance of an AVR pin, and its internal pull-up. */
const PIN_OHMS = 25;
const PULLUP_OHMS = 35_000;
/** A pin reads HIGH above this voltage (AVR at 5 V: about 0.6·Vcc). */
const HIGH_THRESHOLD = 3.0;
const LOW_THRESHOLD = 1.5;

export type LedColour = 'red' | 'yellow' | 'green' | 'blue' | 'white';
const LED_VF: Record<LedColour, number> = { red: 1.8, yellow: 2.0, green: 2.1, blue: 3.0, white: 3.0 };
/** Above this an ordinary 5 mm LED is being damaged. */
const LED_MAX_MA = 30;
const PIN_MAX_MA = 40;
/**
 * A small yellow "TT" gear motor (130-size, 3–6 V) as a load: about 150 mA at 5 V while running
 * (the stall current is much higher; back-EMF is not modelled). Below about 0.8 V it does not turn.
 */
const DC_MOTOR_OHMS = 33;
const DC_MOTOR_START_VOLTS = 0.8;
/** On-resistance of one side of an H-bridge driver output (TB6612FNG: about 0.5 Ω). */
const BRIDGE_OHMS = 0.5;

interface Base {
  id: string;
  /** Shown to the learner, e.g. "LED on pin 13". */
  label: string;
}
export type Part =
  | (Base & { kind: 'resistor'; a: string; b: string; ohms: number })
  | (Base & { kind: 'led'; anode: string; cathode: string; colour: LedColour })
  /** Momentary push button: closed while `pressed`. */
  | (Base & { kind: 'button'; a: string; b: string })
  /** Slide switch: stays where it is put. */
  | (Base & { kind: 'switch'; a: string; b: string })
  /** Three-terminal potentiometer; `position` 0…1 moves the wiper from `low` to `high`. */
  | (Base & { kind: 'potentiometer'; high: string; wiper: string; low: string; ohms: number })
  /** Active buzzer: sounds while enough voltage is across it. */
  | (Base & { kind: 'buzzer'; pos: string; neg: string })
  /** A module with a logic input (relay board, detector output): draws little, switches at the logic threshold. */
  | (Base & { kind: 'logic-load'; input: string; activeHigh: boolean })
  /** One channel of a motor driver: `direction` HIGH = forward, `speed` is the PWM enable input. */
  | (Base & { kind: 'motor'; direction: string; speed: string })
  /**
   * One channel of an H-bridge motor driver on the board (the Malkon SMRS's TB6612FNG): `direction`
   * HIGH drives `out1` positive, LOW drives `out2` positive; the PWM duty on `speed` sets the average
   * voltage. Powered from the 5 V supply; the pins only carry logic signals.
   */
  | (Base & { kind: 'h-bridge'; direction: string; speed: string; out1: string; out2: string })
  /** A DC motor wired straight into the circuit: turns forward when `pos` is above `neg`. */
  | (Base & { kind: 'dc-motor'; pos: string; neg: string })
  /** A module that drives its output pin itself (a detector's signal line), set by the learner. */
  | (Base & { kind: 'signal'; output: string; activeHigh: boolean });

export interface Circuit {
  parts: Part[];
}

/** What a part is doing right now. */
export interface PartState {
  /** Voltage across the part (or at its input), volts. */
  volts: number;
  /** Current through it, milliamps. */
  milliamps: number;
  /** LED brightness 0…1; buzzer and logic loads: 1 when on; motors: speed −1…1 (negative = backwards). */
  level: number;
  /** For parts the learner operates: button/switch closed, signal active (0/1), potentiometer position 0…1. */
  input?: number;
  problem?: string;
}

export interface PinState {
  mode: 'unused' | 'output' | 'pwm' | 'input' | 'input_pullup';
  volts: number;
  /** Current the pin supplies (positive) or sinks (negative), milliamps. */
  milliamps: number;
}

export interface SimState {
  parts: Record<string, PartState>;
  pins: Record<string, PinState>;
  /** Total current drawn from the 5 V supply, milliamps. */
  supplyMilliamps: number;
  /** Voltage of every circuit node (pins, 5V, GND and the nets between parts), volts. */
  nodes: Record<string, number>;
  problems: string[];
}

/** Node name of a board pin: digital pin number, with analog channels numbered after the digital pins. */
export const pinNode = (pin: number): string => `D${pin}`;
export function analogBase(board: BoardDefinition): number {
  return Math.max(...board.pins.digital) + 1;
}
/** "13" or "A0" (as stored in pin fields) → node name. */
export function nodeOfPinField(board: BoardDefinition, value: string): string | undefined {
  const analog = /^A(\d+)$/.exec(value);
  if (analog) return pinNode(analogBase(board) + Number(analog[1]));
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? pinNode(n) : undefined;
}
/** Node name → the label printed on the board ("13", "A0"). */
export function pinLabel(board: BoardDefinition, node: string): string {
  const n = Number(node.slice(1));
  const base = analogBase(board);
  return n >= base ? `A${n - base}` : String(n);
}

interface Drive {
  mode: PinState['mode'];
  /** Output level 0…1 (1 = 5 V). PWM uses the duty cycle. */
  level: number;
}

export class CircuitSimulator implements LiveBoard {
  private readonly drives = new Map<string, Drive>();
  /** Learner-operated inputs by part id. */
  private readonly inputs = new Map<string, number>();
  private state: SimState;
  private listener: ((state: SimState) => void) | undefined;

  constructor(
    readonly circuit: Circuit,
    readonly board: BoardDefinition,
  ) {
    for (const p of circuit.parts) if (p.kind === 'potentiometer') this.inputs.set(p.id, 0.5);
    this.state = this.compute();
  }

  /** Called with the new state whenever the circuit changes. */
  onChange(listener: ((state: SimState) => void) | undefined): void {
    this.listener = listener;
  }

  getState(): SimState {
    return this.state;
  }

  /** Operate a part: button or switch (0 open, 1 closed), signal (0/1), potentiometer (0…1). */
  setInput(partId: string, value: number): void {
    this.inputs.set(partId, Math.min(Math.max(value, 0), 1));
    this.update();
  }

  /** Back to power-on: every pin unused, buttons released. Switch and potentiometer positions stay. */
  reset(): void {
    this.drives.clear();
    for (const p of this.circuit.parts) if (p.kind === 'button') this.inputs.delete(p.id);
    this.update();
  }

  private update(): void {
    this.state = this.compute();
    this.listener?.(this.state);
  }

  /**
   * The circuit's parts as solver elements. `powered: false` leaves out everything that makes
   * its own voltage (sensor modules), as an ohmmeter needs.
   */
  private partElements(powered: boolean): Element[] {
    const els: Element[] = [];
    for (const p of this.circuit.parts) {
      const input = this.inputs.get(p.id) ?? 0;
      switch (p.kind) {
        case 'resistor':
          els.push({ type: 'R', id: p.id, a: p.a, b: p.b, ohms: p.ohms });
          break;
        case 'led':
          els.push({ type: 'D', id: p.id, anode: p.anode, cathode: p.cathode, ...ledModel(LED_VF[p.colour]) });
          break;
        case 'button':
        case 'switch':
          if (input >= 0.5) els.push({ type: 'R', id: p.id, a: p.a, b: p.b, ohms: 0.05 });
          break;
        case 'potentiometer': {
          els.push({ type: 'R', id: `${p.id}:top`, a: p.high, b: p.wiper, ohms: Math.max(p.ohms * (1 - input), 1) });
          els.push({ type: 'R', id: `${p.id}:bottom`, a: p.wiper, b: p.low, ohms: Math.max(p.ohms * input, 1) });
          break;
        }
        case 'buzzer':
          els.push({ type: 'R', id: p.id, a: p.pos, b: p.neg, ohms: 250 });
          break;
        case 'dc-motor':
          els.push({ type: 'R', id: p.id, a: p.pos, b: p.neg, ohms: DC_MOTOR_OHMS });
          break;
        case 'h-bridge': {
          els.push({ type: 'R', id: `${p.id}:dir`, a: p.direction, b: GROUND, ohms: 100_000 });
          els.push({ type: 'R', id: `${p.id}:speed`, a: p.speed, b: GROUND, ohms: 100_000 });
          const { forward, duty } = this.bridge(p);
          // Each output is a source behind the driver's on-resistance: the low side is held at 0 V (brake).
          const out = [
            [p.out1, forward ? duty : 0],
            [p.out2, forward ? 0 : duty],
          ] as const;
          // With the power off (an ohmmeter) the outputs are open.
          if (powered)
            out.forEach(([node, level], i) => {
              els.push({ type: 'V', id: `${p.id}:${i + 1}:drive`, pos: `${p.id}:${i + 1}:src`, neg: GROUND, volts: level * SUPPLY_VOLTS });
              els.push({ type: 'R', id: `${p.id}:${i + 1}`, a: `${p.id}:${i + 1}:src`, b: node, ohms: BRIDGE_OHMS });
            });
          break;
        }
        case 'logic-load':
          els.push({ type: 'R', id: p.id, a: p.input, b: GROUND, ohms: 10_000 });
          break;
        case 'motor':
          els.push({ type: 'R', id: `${p.id}:dir`, a: p.direction, b: GROUND, ohms: 100_000 });
          els.push({ type: 'R', id: `${p.id}:speed`, a: p.speed, b: GROUND, ohms: 100_000 });
          break;
        case 'signal': {
          if (!powered) break;
          const high = (input >= 0.5) === p.activeHigh;
          els.push({ type: 'V', id: `${p.id}:src`, pos: `${p.id}:out`, neg: GROUND, volts: high ? SUPPLY_VOLTS : 0 });
          els.push({ type: 'R', id: p.id, a: `${p.id}:out`, b: p.output, ohms: 1000 });
          break;
        }
      }
    }
    return els;
  }

  /** What the program asks of a driver channel: direction from its pin, speed from the duty on its enable pin. */
  private bridge(p: Extract<Part, { kind: 'h-bridge' }>): { forward: boolean; duty: number } {
    const dir = this.drives.get(p.direction);
    const speed = this.drives.get(p.speed);
    const outputs = (d: Drive | undefined) => d && (d.mode === 'output' || d.mode === 'pwm');
    return { forward: !outputs(dir) || dir!.level >= 0.5, duty: outputs(speed) ? speed!.level : 0 };
  }

  /**
   * Ohmmeter: resistance between two nodes with the power off, the way a real meter must be
   * used. A small test voltage (0.3 V) is applied, so LEDs read as open, as they do on most
   * meters. Infinity means no path ("OL" on a meter).
   */
  measureResistance(a: string, b: string): number {
    if (a === b) return 0;
    const TEST = 0.3;
    const sol = solve([...this.partElements(false), { type: 'V', id: 'ohmmeter', pos: a, neg: b, volts: TEST }], b);
    const amps = sol.amps['ohmmeter'] ?? 0;
    return amps > 1e-10 ? TEST / amps : Infinity;
  }

  private compute(): SimState {
    const els: Element[] = [{ type: 'V', id: 'supply', pos: SUPPLY, neg: GROUND, volts: SUPPLY_VOLTS }];
    const problems: string[] = [];
    // Pins: an output is a source behind the pin's resistance; a pull-up is a resistor to 5 V.
    for (const [node, d] of this.drives) {
      if (d.mode === 'output' || d.mode === 'pwm') {
        els.push({ type: 'V', id: `drive:${node}`, pos: `${node}:src`, neg: GROUND, volts: d.level * SUPPLY_VOLTS });
        els.push({ type: 'R', id: `pin:${node}`, a: `${node}:src`, b: node, ohms: PIN_OHMS });
      } else if (d.mode === 'input_pullup') els.push({ type: 'R', id: `pin:${node}`, a: SUPPLY, b: node, ohms: PULLUP_OHMS });
    }
    els.push(...this.partElements(true));

    const sol = solve(els);
    if (!sol.converged) problems.push('The simulator could not settle this circuit; the values shown may be wrong.');
    const v = (node: string) => sol.volts[node] ?? 0;
    const mA = (id: string) => (sol.amps[id] ?? 0) * 1000;

    const parts: Record<string, PartState> = {};
    for (const p of this.circuit.parts) {
      const input = this.inputs.get(p.id) ?? 0;
      let s: PartState;
      switch (p.kind) {
        case 'resistor':
          s = { volts: v(p.a) - v(p.b), milliamps: mA(p.id), level: 0 };
          break;
        case 'led': {
          const i = mA(p.id);
          // The eye is far from linear; a square root makes 2 mA look clearly lit, as it does in real life.
          s = { volts: v(p.anode) - v(p.cathode), milliamps: i, level: Math.min(Math.sqrt(Math.max(i, 0) / 20), 1) };
          if (i > LED_MAX_MA) s.problem = `${p.label}: ${Math.round(i)} mA is too much and would damage it. It needs a resistor in series.`;
          break;
        }
        case 'button':
        case 'switch':
          s = { volts: v(p.a) - v(p.b), milliamps: mA(p.id), level: 0, input };
          break;
        case 'potentiometer':
          s = { volts: v(p.wiper), milliamps: mA(`${p.id}:top`), level: 0, input };
          break;
        case 'buzzer': {
          const across = v(p.pos) - v(p.neg);
          s = { volts: across, milliamps: mA(p.id), level: across > 2.5 ? 1 : 0 };
          break;
        }
        case 'dc-motor': {
          const across = v(p.pos) - v(p.neg);
          const speed = Math.min(Math.max((Math.abs(across) - DC_MOTOR_START_VOLTS) / (SUPPLY_VOLTS - DC_MOTOR_START_VOLTS), 0), 1);
          s = { volts: across, milliamps: mA(p.id), level: Math.sign(across) * speed };
          if ([p.pos, p.neg].some((n) => this.drives.has(n)) && Math.abs(s.milliamps) > PIN_MAX_MA)
            s.problem = `${p.label}: a pin cannot power a motor (it needs about ${Math.round(Math.abs(s.milliamps))} mA). Use a motor driver or a transistor.`;
          break;
        }
        case 'h-bridge': {
          const { forward, duty } = this.bridge(p);
          s = { volts: v(p.out1) - v(p.out2), milliamps: Math.abs(mA(`${p.id}:1`)), level: forward ? duty : -duty };
          break;
        }
        case 'logic-load': {
          const high = v(p.input) > HIGH_THRESHOLD;
          s = { volts: v(p.input), milliamps: mA(p.id), level: high === p.activeHigh && (high || this.drives.has(p.input)) ? 1 : 0 };
          break;
        }
        case 'motor': {
          const forward = v(p.direction) > (HIGH_THRESHOLD + LOW_THRESHOLD) / 2;
          const duty = Math.min(Math.max(v(p.speed) / SUPPLY_VOLTS, 0), 1);
          s = { volts: v(p.speed), milliamps: 0, level: forward ? duty : -duty };
          break;
        }
        case 'signal':
          s = { volts: v(p.output), milliamps: mA(p.id), level: input >= 0.5 ? 1 : 0, input };
          break;
      }
      if (s.problem) problems.push(s.problem);
      parts[p.id] = s;
    }

    const pins: Record<string, PinState> = {};
    for (const [node, d] of this.drives) {
      const current = d.mode === 'output' || d.mode === 'pwm' ? mA(`drive:${node}`) : 0;
      pins[node] = { mode: d.mode, volts: v(node), milliamps: current };
      if (Math.abs(current) > PIN_MAX_MA) problems.push(`Pin ${pinLabel(this.board, node)} carries ${Math.round(Math.abs(current))} mA. More than ${PIN_MAX_MA} mA can damage the board.`);
    }
    // Node voltages, without the solver's internal points (a pin's source behind its resistance).
    const nodes: Record<string, number> = {};
    for (const [name, volts] of Object.entries(sol.volts)) if (!/:(src|out)$/.test(name)) nodes[name] = volts;
    return { parts, pins, supplyMilliamps: mA('supply'), nodes, problems };
  }

  private drive(pin: number, mode: Drive['mode'], level: number): void {
    this.drives.set(pinNode(pin), { mode, level });
    this.update();
  }

  // ───────── LiveBoard: what the block program does to the board ─────────

  async digitalWrite(pin: number, on: boolean): Promise<void> {
    this.drive(pin, 'output', on ? 1 : 0);
  }

  async analogWrite(pin: number, value: number): Promise<void> {
    this.drive(pin, 'pwm', Math.min(Math.max(value, 0), 255) / 255);
  }

  async servoWrite(): Promise<void> {
    throw new Error('Servo motors are not in the simulator yet.');
  }

  async digitalRead(pin: number, pullup: boolean): Promise<boolean> {
    const node = pinNode(pin);
    const mode = pullup ? 'input_pullup' : 'input';
    if (this.drives.get(node)?.mode !== mode) this.drive(pin, mode, 0);
    const volts = this.state.pins[node]?.volts ?? 0;
    // Between the thresholds a real pin is undefined; report LOW, as a floating input usually reads on the bench.
    return volts > HIGH_THRESHOLD;
  }

  async analogRead(channel: number): Promise<number> {
    const pin = analogBase(this.board) + channel;
    const node = pinNode(pin);
    if (this.drives.get(node)?.mode !== 'input') this.drive(pin, 'input', 0);
    const volts = Math.min(Math.max(this.state.pins[node]?.volts ?? 0, 0), SUPPLY_VOLTS);
    return Math.round((volts / SUPPLY_VOLTS) * 1023);
  }

  async analogPin(channel: number): Promise<number | undefined> {
    return channel < this.board.pins.analog.length ? analogBase(this.board) + channel : undefined;
  }
}
