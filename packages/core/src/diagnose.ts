/**
 * Guided diagnosis (Phase 8d): "why isn't it working?" The learner says what is wrong; this lists
 * what could cause it. A cause the app found evidence for (in the program, the workbench, the last
 * upload or the safety settings) is marked `found` and comes first; every other cause is only a
 * possibility, said as one, with a way to check it. It never claims to know what is wrong on a real
 * breadboard the app cannot see.
 */
import type { BoardDefinition, PinUse } from './types.js';
import type { BlockJson, WorkspaceJson } from './codegen/workspace.js';
import { analyseLayout, type CircuitLayout } from './sim/layout.js';
import type { WiringProblem } from './sim/check.js';
import { buildSchematic } from './sim/schematic.js';
import { nodeOfPinField, pinLabel } from './sim/circuit.js';

export type Symptom = 'led' | 'button' | 'motor' | 'upload' | 'other';

export const SYMPTOMS: Array<{ id: Symptom; text: string }> = [
  { id: 'led', text: 'An LED does not light' },
  { id: 'button', text: 'Pressing a button does nothing' },
  { id: 'motor', text: 'A motor does not turn' },
  { id: 'upload', text: 'The program does not upload' },
  { id: 'other', text: 'Something else' },
];

export interface DiagnoseEvidence {
  board: BoardDefinition;
  workspace: WorkspaceJson;
  /** From the code generator: the pins the program sets up, and its warnings. */
  pins: PinUse[];
  warnings: Array<{ blockId?: string; message: string }>;
  /** The workbench, when something is built on it, and the circuit check's findings. */
  layout?: CircuitLayout | undefined;
  wiring: WiringProblem[];
  /** The port chosen under Connect, if any. */
  port?: string | null | undefined;
  /** The last Verify or Upload. */
  lastBuild?: { ok: boolean; message: string; diagnostics: number } | null | undefined;
  estop?: boolean;
  /** Motor speed limit, percent. */
  motorLimit?: number;
}

export interface Cause {
  id: string;
  title: string;
  /** True when the app found evidence of it; false when it is only a possibility it cannot check. */
  found: boolean;
  /** What was found, or why it could be this. */
  why: string;
  /** How to check or fix it. */
  check: string;
  blockId?: string;
  partId?: string;
}

const LOOPS = new Set(['tariro_forever', 'controls_repeat_ext', 'controls_repeat', 'controls_whileUntil', 'controls_for', 'controls_forEach']);

/** Each block id → the ids of the blocks it sits inside (not the ones before it in a stack). */
function containers(workspace: WorkspaceJson): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const visit = (b: BlockJson | undefined, inside: string[]) => {
    for (let cur = b; cur; cur = cur.next?.block) {
      out.set(cur.id ?? '', inside);
      for (const input of Object.values(cur.inputs ?? {})) visit(input.block ?? input.shadow, [...inside, cur.type]);
    }
  };
  for (const top of workspace.blocks?.blocks ?? []) visit(top, []);
  return out;
}

/** Literal speeds given to the motor blocks. */
function motorSpeeds(workspace: WorkspaceJson): Array<{ blockId: string; speed: number }> {
  const out: Array<{ blockId: string; speed: number }> = [];
  const visit = (b: BlockJson | undefined) => {
    for (let cur = b; cur; cur = cur.next?.block) {
      if (cur.type === 'tariro_motor_run' || cur.type === 'tariro_drive') {
        const n = cur.inputs?.['SPEED']?.shadow ?? cur.inputs?.['SPEED']?.block;
        const v = n?.type === 'math_number' ? Number(n.fields?.['NUM']) : NaN;
        if (Number.isFinite(v)) out.push({ blockId: cur.id ?? '', speed: v });
      }
      for (const input of Object.values(cur.inputs ?? {})) visit(input.block);
    }
  };
  for (const top of workspace.blocks?.blocks ?? []) visit(top);
  return out;
}

/** Which pin each workbench part's chain starts from. */
function benchPinsOf(layout: CircuitLayout | undefined, board: BoardDefinition, kind: 'led' | 'button' | 'switch'): Array<{ partId: string; label: string; pin: string }> {
  if (!layout?.parts.length) return [];
  const s = buildSchematic(analyseLayout(layout, board).circuit.parts, board);
  const out: Array<{ partId: string; label: string; pin: string }> = [];
  for (const row of s.rows) {
    const pinEnd = row.from.kind === 'pin' ? row.from : row.to.kind === 'pin' ? row.to : undefined;
    if (!pinEnd) continue;
    for (const item of row.items) if (item.kind === kind) out.push({ partId: item.partId, label: item.label, pin: pinLabel(board, pinEnd.node) });
  }
  return out;
}

const usesPin = (pins: PinUse[], board: BoardDefinition, pin: string, modes: Array<PinUse['mode']>) =>
  pins.some((u) => nodeOfPinField(board, u.pin) === nodeOfPinField(board, pin) && modes.includes(u.mode));

export function diagnose(symptom: Symptom, ev: DiagnoseEvidence): Cause[] {
  const causes: Cause[] = [];
  const found = (c: Omit<Cause, 'found'>) => causes.push({ ...c, found: true });
  const maybe = (c: Omit<Cause, 'found'>) => causes.push({ ...c, found: false });
  const partKind = (id: string | undefined) => ev.layout?.parts.find((p) => p.id === id)?.kind;
  const wiringAbout = (kinds: string[]) => ev.wiring.filter((w) => kinds.includes(partKind(w.partId) ?? ''));
  const conflicts = ev.warnings.filter((w) => /^Pin \S+ is (already set up|wired to)/.test(w.message));

  switch (symptom) {
    case 'led': {
      for (const w of wiringAbout(['led'])) found({ id: `wiring:${w.partId}`, title: /backwards/.test(w.message) ? 'The LED is in backwards' : 'The LED has no resistor', why: w.message, check: 'Fix it on the workbench, and on your real breadboard if you built it.', ...(w.partId ? { partId: w.partId } : {}) });
      for (const led of benchPinsOf(ev.layout, ev.board, 'led'))
        if (!usesPin(ev.pins, ev.board, led.pin, ['OUTPUT']))
          found({ id: `pin:${led.partId}`, title: `The program never switches pin ${led.pin} on`, why: `${led.label} is wired to pin ${led.pin}, but no block in the program uses pin ${led.pin} as an output.`, check: `Choose pin ${led.pin} in the LED block, or move the LED's wire to the pin the block uses.`, partId: led.partId });
      for (const w of ev.wiring.filter((x) => /nothing on the workbench is wired/.test(x.message))) found({ id: `unwired:${w.blockId}`, title: 'The pin the program uses has nothing on it', why: w.message, check: 'Wire the LED (with its resistor) to that pin, or change the pin in the block.', ...(w.blockId ? { blockId: w.blockId } : {}) });
      if (!ev.pins.some((u) => u.mode === 'OUTPUT')) found({ id: 'no-output', title: 'The program does not switch any pin on', why: 'No block in the program sets a pin up as an output.', check: 'Add an LED block (Basic Components) or "set pin … to HIGH" (Pins).' });
      maybe({ id: 'real-backwards', title: 'On the real breadboard, the LED could be the wrong way round', why: 'An LED only lets current through one way.', check: 'Its long leg (+) goes towards the pin, its short leg (−) towards GND.' });
      maybe({ id: 'real-holes', title: 'The legs could be in holes that are not joined as you think', why: 'Holes in a column of five are joined; the centre gap and the rows are not.', check: 'Look at each leg and wire: does each step of the path share a column of five with the next?' });
      maybe({ id: 'too-quick', title: 'It could switch on and straight off again', why: 'Without a wait, the LED can be on for too short a time to see.', check: 'Step through the program with the Debugger, or add "wait 1 second" after turning it on.' });
      maybe({ id: 'broken', title: 'The LED or the resistor could be faulty, or the resistor too big', why: 'A 220 Ω to 1 kΩ resistor lights an LED well; 100 kΩ hardly lights it.', check: 'Read the resistor’s colour bands, and try another LED.' });
      break;
    }
    case 'button': {
      for (const w of [...wiringAbout(['button', 'switch'])]) found({ id: `wiring:${w.partId}`, title: /floats/.test(w.message) ? 'The pin floats while the button is up' : 'The button is wired in a way that cannot change the pin', why: w.message, check: 'Fix the wiring or the block as the message says.', ...(w.partId ? { partId: w.partId } : {}) });
      for (const w of conflicts) found({ id: `conflict:${w.blockId}`, title: 'Two blocks use the same pin for different jobs', why: w.message, check: 'Give the button its own pin.', ...(w.blockId ? { blockId: w.blockId } : {}) });
      for (const b of [...benchPinsOf(ev.layout, ev.board, 'button'), ...benchPinsOf(ev.layout, ev.board, 'switch')])
        if (!usesPin(ev.pins, ev.board, b.pin, ['INPUT', 'INPUT_PULLUP']))
          found({ id: `pin:${b.partId}`, title: `The program never reads pin ${b.pin}`, why: `${b.label} is wired to pin ${b.pin}, but no block in the program reads pin ${b.pin}.`, check: `Choose pin ${b.pin} in the button block, or move the button's wire.`, partId: b.partId });
      const inside = containers(ev.workspace);
      for (const u of ev.pins.filter((p) => p.mode !== 'OUTPUT' && p.blockId))
        if (!(inside.get(u.blockId!) ?? []).some((t) => LOOPS.has(t)))
          found({ id: `once:${u.blockId}`, title: 'The program reads the button only once', why: `The block that reads pin ${u.pin} is not inside a loop, so it reads the pin once, at the start, and never again.`, check: 'Put the reading (and what it decides) inside "forever".', blockId: u.blockId! });
      if (ev.pins.some((u) => u.mode === 'INPUT_PULLUP'))
        maybe({ id: 'pullup-inverted', title: 'Pressed could read LOW, not HIGH', why: 'With the pull-up, the pin reads HIGH while the button is up and LOW while it is pressed.', check: 'Use "button pressed?", or test for LOW instead of HIGH.' });
      maybe({ id: 'four-legs', title: 'A four-legged button could be turned the wrong way', why: 'Two pairs of its legs are always joined; across the wrong pair, it seems always pressed or never.', check: 'Put it across the centre gap, and wire to legs on opposite corners.' });
      maybe({ id: 'loose', title: 'A wire could be loose or in the wrong hole', why: 'The app cannot see your real breadboard.', check: 'Use "Pins" in the Debugger while you press: does the pin’s reading change?' });
      break;
    }
    case 'motor': {
      if (ev.estop) found({ id: 'estop', title: 'The emergency stop is on', why: 'After E-STOP the board stays off until Reset.', check: 'Press Reset in the red banner.' });
      if (ev.motorLimit !== undefined && ev.motorLimit < 50) found({ id: 'limit', title: `The motor speed limit is ${ev.motorLimit} %`, why: 'Live, Stage and Python programs cannot drive the motors faster than the limit set under Connect; a low limit may be too little to start them.', check: 'Raise the limit under Connect → Motor speed limit.' });
      for (const s of motorSpeeds(ev.workspace).filter((x) => x.speed > 0 && x.speed < 25))
        found({ id: `slow:${s.blockId}`, title: `A motor block asks for only ${s.speed} %`, why: 'Small gear motors usually need about 25–30 % or more before they start to turn.', check: 'Try 50 %, then lower it once it moves.', blockId: s.blockId });
      for (const w of ev.warnings.filter((x) => /motor/i.test(x.message))) found({ id: `warn:${w.blockId}`, title: 'A block warns about the motors', why: w.message, check: 'Follow the warning on the block.', ...(w.blockId ? { blockId: w.blockId } : {}) });
      maybe({ id: 'battery', title: 'The motors could have no power', why: 'USB alone often cannot turn motors; the board needs its battery, switched on and charged.', check: 'Switch the battery on and check it is charged.' });
      maybe({ id: 'terminal', title: 'The motor wires could be loose in the screw terminal', why: 'The app cannot see the real terminals.', check: 'Tighten the screws on the motor terminal and tug each wire gently.' });
      maybe({ id: 'uploaded', title: 'An uploaded program runs on the board by itself', why: 'In Upload mode the program runs on the board, outside the app: the safety limit and E-STOP do not reach it.', check: 'Check the uploaded program’s motor blocks, or try the same blocks with Run live.' });
      break;
    }
    case 'upload': {
      if (!ev.port) found({ id: 'no-port', title: 'No board is chosen under Connect', why: 'The app does not know which USB port the board is on.', check: 'Plug the board in, open Connect and choose its port.' });
      if (ev.lastBuild && !ev.lastBuild.ok) {
        const m = ev.lastBuild.message;
        if (ev.lastBuild.diagnostics > 0) found({ id: 'compile', title: 'The program did not compile', why: m, check: 'Open Problems: each compiler message is shown on its block.' });
        else if (/permission|access|denied|busy/i.test(m)) found({ id: 'port-access', title: 'The port could not be opened', why: m, check: 'Close the Serial Monitor and any other program using the board. On Linux, your account may need to be in the "dialout" group.' });
        else if (/sync|stk500|not responding|timed out|timeout/i.test(m)) found({ id: 'no-answer', title: 'The board did not answer the uploader', why: m, check: 'Check that the right board is chosen under Board, press the board’s reset button, and try again.' });
        else found({ id: 'failed', title: 'The last upload failed', why: m, check: 'Open the Output tab to read what the uploader said.' });
      }
      maybe({ id: 'cable', title: 'The USB cable could be a charging-only cable', why: 'Some cables carry power but no data: the board lights up but no port appears.', check: 'Try another cable you know carries data.' });
      maybe({ id: 'driver', title: 'The USB driver could be missing (Windows)', why: 'Boards with a CH340 chip need its driver on some versions of Windows.', check: 'Look in Device Manager under Ports for the board.' });
      maybe({ id: 'wrong-board', title: 'A different board could be chosen', why: 'Each board needs its own uploader settings.', check: 'Open Board and pick the board you plugged in.' });
      break;
    }
    case 'other': {
      for (const w of ev.wiring) found({ id: `wiring:${w.partId ?? w.blockId}`, title: 'The circuit check found something', why: w.message, check: 'Fix it on the workbench.', ...(w.partId ? { partId: w.partId } : {}), ...(w.blockId ? { blockId: w.blockId } : {}) });
      for (const w of conflicts) found({ id: `conflict:${w.blockId}`, title: 'Two blocks use one pin for different jobs', why: w.message, check: 'Give each job its own pin.', ...(w.blockId ? { blockId: w.blockId } : {}) });
      maybe({ id: 'step', title: 'The program could be doing something different from what you expect', why: 'Programs do exactly what the blocks say, in order.', check: 'Add a breakpoint and step through it with the Debugger, watching the variables and pins.' });
      break;
    }
  }
  // What was found first; within each, the order above.
  return [...causes.filter((c) => c.found), ...causes.filter((c) => !c.found)];
}
