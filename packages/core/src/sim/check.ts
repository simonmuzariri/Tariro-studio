/**
 * The circuit check (Phase 8a): the program and the workbench wiring, compared before anything runs.
 *
 * The program says how it sets each pin up (`PinUse`, from the code generator); the workbench says
 * what is wired to each pin. Some mistakes show from that alone (a pin the program uses with nothing
 * on it, an input with only an LED on it). Others need the circuit tried: every output the program
 * uses is set HIGH, then LOW, in the simulator, with the buttons not pressed, and the LEDs and pins
 * are looked at (an LED with no resistor, an LED in backwards, an input that floats).
 *
 * Every message says what was found and what usually fixes it; the check cannot know what the
 * learner meant, so it never rewires anything.
 */
import type { BoardDefinition, PinUse } from '../types.js';
import { CircuitSimulator, nodeOfPinField, pinLabel, SUPPLY, type Part } from './circuit.js';
import { analyseLayout, type CircuitLayout } from './layout.js';
import { GROUND } from './solver.js';

export interface WiringProblem {
  message: string;
  /** Errors would damage a part or the board when run; warnings are mistakes that stop it working. */
  severity: 'error' | 'warning';
  /** The workbench part it is about. */
  partId?: string;
  /** The block that uses the pin. */
  blockId?: string;
}

const MODE_WORDS: Record<PinUse['mode'], string> = { OUTPUT: 'as an output', INPUT: 'as an input', INPUT_PULLUP: 'as an input with pull-up' };

/** The nodes each part's legs are on, by leg name. */
function legsOf(p: Part): Record<string, string> {
  switch (p.kind) {
    case 'resistor':
    case 'button':
    case 'switch':
      return { a: p.a, b: p.b };
    case 'led':
      return { anode: p.anode, cathode: p.cathode };
    case 'potentiometer':
      return { high: p.high, wiper: p.wiper, low: p.low };
    case 'buzzer':
    case 'dc-motor':
      return { pos: p.pos, neg: p.neg };
    default:
      // The board's own motor driver, and modules not placed on the workbench.
      return {};
  }
}

const isSwitchLike = (p: Part) => p.kind === 'button' || p.kind === 'switch';
const otherLeg = (p: Part, node: string) => Object.values(legsOf(p)).find((n) => n !== node);
const railName = (node: string | undefined) => (node === GROUND ? 'GND' : node === SUPPLY ? '5V' : undefined);

export function checkWiring(pins: PinUse[], layout: CircuitLayout, board: BoardDefinition): WiringProblem[] {
  const placed = layout.parts.filter((p) => p.kind !== 'chassis');
  if (!placed.length) return [];
  const analysis = analyseLayout(layout, board);
  // Wiring errors (a short, two parts in one hole) are reported by the workbench itself; checking on top of them would only confuse.
  if (analysis.problems.some((p) => p.severity === 'error')) return [];
  const parts = analysis.circuit.parts;
  const problems: WiringProblem[] = [];
  const driverPins = new Set(Object.values(board.onboard?.find((o) => o.kind === 'dual-motor-driver')?.pins ?? {}).map(String));

  // First use of each pin (a second, different use is the code generator's warning).
  const uses = new Map<string, PinUse & { node: string }>();
  for (const u of pins) {
    const node = nodeOfPinField(board, u.pin);
    if (node && !uses.has(node) && !driverPins.has(u.pin)) uses.set(node, { ...u, node });
  }
  const on = (node: string) => parts.filter((p) => Object.values(legsOf(p)).includes(node));
  const blockOf = (u: PinUse) => (u.blockId ? { blockId: u.blockId } : {});

  for (const u of uses.values()) {
    const label = pinLabel(board, u.node);
    const here = on(u.node);
    if (!here.length) {
      problems.push({ message: `The program uses pin ${label} ${MODE_WORDS[u.mode]}, but nothing on the workbench is wired to pin ${label}.`, severity: 'warning', ...blockOf(u) });
      continue;
    }
    const switches = here.filter(isSwitchLike);
    if (u.mode === 'OUTPUT') {
      for (const s of switches) {
        const rail = railName(otherLeg(s, u.node));
        if (rail)
          problems.push({
            message: `Pressing ${s.label} joins pin ${label} straight to ${rail} while the program drives it: a short that can damage the pin. A pin with a button on it should be an input (for example "button pressed?").`,
            severity: 'warning',
            partId: s.id,
            ...blockOf(u),
          });
      }
    } else {
      if (!here.some((p) => isSwitchLike(p) || p.kind === 'potentiometer' || p.kind === 'resistor'))
        problems.push({
          message: `The program reads pin ${label}, but only ${here.map((p) => p.label).join(' and ')} ${here.length > 1 ? 'are' : 'is'} wired there: nothing that could change what the pin reads, like a button.`,
          severity: 'warning',
          ...blockOf(u),
        });
      for (const s of switches) {
        if (u.mode === 'INPUT_PULLUP' && railName(otherLeg(s, u.node)) === '5V')
          problems.push({
            message: `${s.label} joins pin ${label} to 5V, but the pull-up already holds the pin HIGH, so pressing it changes nothing. Wire its other leg to GND instead.`,
            severity: 'warning',
            partId: s.id,
            ...blockOf(u),
          });
      }
    }
  }

  // Try the circuit: inputs set up as the program sets them, outputs HIGH, then LOW.
  const sim = new CircuitSimulator(analysis.circuit, board);
  for (const u of uses.values()) {
    if (u.mode === 'OUTPUT') continue;
    const n = Number(u.node.slice(1));
    void sim.digitalRead(n, u.mode === 'INPUT_PULLUP');
    // A plain input with only a button or switch on it floats while the button is open.
    const switches = on(u.node).filter(isSwitchLike);
    if (u.mode === 'INPUT' && switches.length && sim.measureResistance(u.node, GROUND) === Infinity && sim.measureResistance(u.node, SUPPLY) === Infinity) {
      const toSupply = railName(otherLeg(switches[0]!, u.node)) === '5V';
      // The fix depends on where the button goes: a pull-down for a button to 5V, the pull-up for one to GND.
      const fix = toSupply
        ? `Add a 10 kΩ resistor from pin ${pinLabel(board, u.node)} to GND (a pull-down), so it reads LOW until the button is pressed.`
        : 'Turn on the pull-up in the block (then pressed reads LOW), or add a 10 kΩ resistor from the pin to 5V.';
      problems.push({
        message: `Pin ${pinLabel(board, u.node)} floats while ${switches[0]!.label} is not pressed (nothing holds it HIGH or LOW), so it reads at random. ${fix}`,
        severity: 'warning',
        partId: switches[0]!.id,
        ...blockOf(u),
      });
    }
  }
  const outputs = [...uses.values()].filter((u) => u.mode === 'OUTPUT');
  const leds = parts.filter((p): p is Extract<Part, { kind: 'led' }> => p.kind === 'led');
  const seen = new Map<string, { lit: boolean; reversed: boolean; problem?: string }>();
  for (const level of [true, false]) {
    for (const u of outputs) void sim.digitalWrite(Number(u.node.slice(1)), level);
    const state = sim.getState();
    for (const led of leds) {
      const s = state.parts[led.id];
      if (!s) continue;
      const was = seen.get(led.id) ?? { lit: false, reversed: false };
      seen.set(led.id, {
        lit: was.lit || s.level > 0.05,
        // Pushed the wrong way: well below zero across it, and no current.
        reversed: was.reversed || s.volts < -1,
        ...((was.problem ?? s.problem) ? { problem: was.problem ?? s.problem! } : {}),
      });
    }
  }
  for (const led of leds) {
    const s = seen.get(led.id);
    if (!s) continue;
    if (s.problem) problems.push({ message: s.problem, severity: 'error', partId: led.id });
    else if (s.reversed && !s.lit)
      problems.push({
        message: `${led.label} never lights: it is in backwards. Turn it round so its long leg (+) points towards the pin and its short leg (−) towards GND.`,
        severity: 'warning',
        partId: led.id,
      });
  }
  return problems;
}
