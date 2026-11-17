/**
 * Board blocks in Stage mode: sprites and the real board in one program (the board is driven over
 * the live-mode USB link). Stage scripts run frame by frame and cannot wait for the board, so
 * outputs are queued and inputs return the latest reading, which the app refreshes about 30 times
 * a second. Behaviour matches the live-mode handlers (live.ts) and the generated C++.
 */
import type { BoardDefinition, ExperienceLevel, ExtensionRegistry, StageBlockContext, StageBoardHandler, ToolboxCategorySpec } from '@tariro-studio/core';
import { DETECTOR_ACTIVE, DRIVE_MOVES, TRAFFIC_LIGHTS } from './live.js';

/** The board as the stage sees it: writes go into a queue, reads come from a cache. */
export interface StageBoardIO {
  digitalWrite(pin: number, on: boolean): void;
  analogWrite(pin: number, value: number): void;
  servoWrite(pin: number, angle: number): void;
  /** The latest reading (false until the first one arrives). */
  digitalRead(pin: number, pullup: boolean): boolean;
  /** The latest reading, 0–1023 (0 until the first one arrives). */
  analogRead(channel: number): number;
}

/** The board blocks that can run on the stage (the Stage mode toolbox offers only these). */
export const STAGE_BOARD_BLOCKS = [
  'io_digital_write',
  'io_pwm_write',
  'io_digital_read',
  'io_analog_read',
  'basic_led',
  'basic_led_brightness',
  'basic_buzzer',
  'basic_switch',
  'sensor_button_pressed',
  'sensor_analog_level',
  'sensor_detect',
  'act_servo',
  'act_rgb_led',
  'act_traffic_light',
  'act_relay',
  'tariro_motor_run',
  'tariro_motor_stop',
  'tariro_drive',
] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

class StagePinError extends Error {}

export function stageBoardHandlers(io: StageBoardIO, board: BoardDefinition): Record<string, StageBoardHandler> {
  const pin = (ctx: StageBlockContext, f = 'PIN'): number => {
    const n = Number(ctx.field(f));
    if (!Number.isInteger(n) || n < 0) throw new StagePinError(`Pin ${ctx.field(f)} is not a pin on ${board.name}.`);
    return n;
  };
  const channel = (ctx: StageBlockContext): number => {
    const m = /^A(\d+)$/.exec(ctx.field('PIN'));
    if (!m) throw new StagePinError(`Pin ${ctx.field('PIN')} is not an analog pin.`);
    return Number(m[1]);
  };
  const statement = (run: (ctx: StageBlockContext) => void): StageBoardHandler => ({ kind: 'statement', run });
  const value = (run: (ctx: StageBlockContext) => number | boolean): StageBoardHandler => ({ kind: 'value', run });

  const motorPins = () => {
    const driver = board.onboard?.find((p) => p.kind === 'dual-motor-driver');
    if (!driver) throw new StagePinError(`${board.name} has no onboard motor driver.`);
    return driver.pins;
  };
  const motorRun = (motor: 'A' | 'B', forward: boolean, percent: number) => {
    const pins = motorPins();
    const duty = clamp(Math.trunc((percent * 255) / 100), 0, 255);
    if (pins['INA'] !== undefined) {
      io.digitalWrite(pins[`IN${motor}`]!, forward);
      io.analogWrite(pins[`EN${motor}`]!, duty);
    } else {
      io.digitalWrite(pins[`${motor}IN1`]!, forward);
      io.digitalWrite(pins[`${motor}IN2`]!, !forward);
      io.analogWrite(pins[`PWM${motor}`]!, duty);
    }
  };
  const motorStop = (motor: 'A' | 'B') => {
    const pins = motorPins();
    if (pins['INA'] !== undefined) io.analogWrite(pins[`EN${motor}`]!, 0);
    else {
      io.digitalWrite(pins[`${motor}IN1`]!, false);
      io.digitalWrite(pins[`${motor}IN2`]!, false);
      io.analogWrite(pins[`PWM${motor}`]!, 0);
    }
  };

  return {
    io_digital_write: statement((ctx) => io.digitalWrite(pin(ctx), ctx.field('STATE') !== 'LOW')),
    io_pwm_write: statement((ctx) => io.analogWrite(pin(ctx), clamp(Math.trunc(ctx.number('VALUE')), 0, 255))),
    io_digital_read: value((ctx) => io.digitalRead(pin(ctx), ctx.field('PULL') === 'INPUT_PULLUP')),
    io_analog_read: value((ctx) => io.analogRead(channel(ctx))),
    basic_led: statement((ctx) => io.digitalWrite(pin(ctx), ctx.field('STATE') !== 'OFF')),
    basic_led_brightness: statement((ctx) => io.analogWrite(pin(ctx), clamp(Math.trunc((ctx.number('LEVEL') * 255) / 100), 0, 255))),
    basic_buzzer: statement((ctx) => io.digitalWrite(pin(ctx), ctx.field('STATE') !== 'OFF')),
    // Wired to GND with the pull-up on: closed reads LOW.
    basic_switch: value((ctx) => io.digitalRead(pin(ctx), true) === (ctx.field('STATE') === 'OPEN')),
    sensor_button_pressed: value((ctx) => !io.digitalRead(pin(ctx), true)),
    sensor_analog_level: value((ctx) => Math.trunc((io.analogRead(channel(ctx)) * 100) / 1023)),
    sensor_detect: value((ctx) => io.digitalRead(pin(ctx), false) === ((DETECTOR_ACTIVE[ctx.field('SENSOR')] ?? 'HIGH') === 'HIGH')),
    act_servo: statement((ctx) => io.servoWrite(pin(ctx), Math.trunc(clamp(ctx.number('ANGLE', 90), 0, 180)))),
    act_rgb_led: statement((ctx) => {
      for (const [f, input] of [['R', 'RV'], ['G', 'GV'], ['B', 'BV']] as const) io.analogWrite(pin(ctx, f), clamp(Math.trunc(ctx.number(input)), 0, 255));
    }),
    act_traffic_light: statement((ctx) => {
      const states = TRAFFIC_LIGHTS[ctx.field('LIGHT')] ?? TRAFFIC_LIGHTS['OFF']!;
      for (const [i, f] of ['RED', 'YELLOW', 'GREEN'].entries()) io.digitalWrite(pin(ctx, f), states[i]!);
    }),
    act_relay: statement((ctx) => {
      const activeLow = ctx.field('ACTIVE') !== 'HIGH';
      io.digitalWrite(pin(ctx), (ctx.field('STATE') !== 'OFF') !== activeLow);
    }),
    tariro_motor_run: statement((ctx) => motorRun(ctx.field('MOTOR') === 'B' ? 'B' : 'A', ctx.field('DIRECTION') !== 'BACKWARD', ctx.number('SPEED'))),
    tariro_drive: statement((ctx) => {
      const [lf, lk, rf, rk] = DRIVE_MOVES[ctx.field('MOVE')] ?? DRIVE_MOVES['FORWARD']!;
      const speed = ctx.number('SPEED');
      motorRun('A', lf, speed * lk);
      motorRun('B', rf, speed * rk);
    }),
    tariro_motor_stop: statement((ctx) => {
      const m = ctx.field('MOTOR');
      for (const motor of m === 'BOTH' ? (['A', 'B'] as const) : [m === 'B' ? ('B' as const) : ('A' as const)]) motorStop(motor);
    }),
  };
}

/**
 * The board categories of the Stage mode toolbox: the board's own categories (Pins, the Tariro
 * motors, Basic Components, Actuators…) with only the blocks the stage can run. Sprite programs
 * bring their own events, control, operators and variables.
 */
export function stageBoardToolbox(registry: ExtensionRegistry, board: BoardDefinition, extensions: string[], level: ExperienceLevel): ToolboxCategorySpec[] {
  const allowed = new Set<string>(STAGE_BOARD_BLOCKS);
  return registry
    .toolboxFor(board, extensions, level)
    .filter((c) => !c.custom)
    .map((c) => {
      const kept = c.contents.filter((i) => i.kind !== 'block' || allowed.has(i.type));
      // Drop labels left without blocks under them.
      const tidy = kept.filter((i, n) => i.kind !== 'label' || kept.slice(n + 1).find((x) => x.kind !== 'sep')?.kind === 'block');
      return { ...c, contents: tidy };
    })
    .filter((c) => c.contents.some((i) => i.kind === 'block'));
}
