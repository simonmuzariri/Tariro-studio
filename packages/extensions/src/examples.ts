/**
 * Example projects shipped with the app (File → Examples). They double as golden programs: each
 * is generated, compared with its checked-in .ino snapshot and, in `npm run test:compile`,
 * compiled with arduino-cli for every board it lists.
 */
import type { WorkspaceJson } from '@tariro-studio/core';
import { block, forever, n, program, set, t, v, wait, workspace } from './build.js';

export interface ExampleProject {
  /** Stable id, also the snapshot file name. */
  name: string;
  title: string;
  description: string;
  /** Kit the example belongs to (shown as a group in the menu). */
  kit: 'Starter' | 'Robotics' | 'IoT';
  /** First board is the one the example opens with; all listed boards are compile-tested. */
  boards: string[];
  /** Extensions (beyond the board's built-ins) the example turns on. */
  extensions?: string[];
  workspace: WorkspaceJson;
}

const blink: ExampleProject = {
  name: 'blink',
  title: 'Blink an LED',
  description: 'Turn the LED on pin 13 on and off every second.',
  kit: 'Starter',
  boards: ['tariro', 'malkon-one', 'arduino-uno', 'arduino-nano', 'arduino-mega'],
  workspace: workspace([
    program(
      forever(
        block('io_digital_write', { fields: { PIN: '13', STATE: 'HIGH' } }),
        wait(1),
        block('io_digital_write', { fields: { PIN: '13', STATE: 'LOW' } }),
        wait(1),
      ),
    ),
  ]),
};

const motor = (dir: 'FORWARD' | 'BACKWARD', m: 'A' | 'B', speed: number) =>
  block('tariro_motor_run', { fields: { MOTOR: m, DIRECTION: dir }, inputs: { SPEED: n(speed) } });

const tariroMotors: ExampleProject = {
  name: 'tariro-motors',
  title: 'Drive forward and back',
  description: 'Run both motors forward, stop, reverse and stop again, in a loop.',
  kit: 'Robotics',
  boards: ['tariro'],
  workspace: workspace([
    program(
      block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: t('Tariro motor test') } }),
      forever(
        motor('FORWARD', 'A', 60),
        motor('FORWARD', 'B', 60),
        wait(2),
        block('tariro_motor_stop', { fields: { MOTOR: 'BOTH' } }),
        wait(0.5),
        motor('BACKWARD', 'A', 40),
        motor('BACKWARD', 'B', 40),
        wait(1),
        block('tariro_motor_stop', { fields: { MOTOR: 'BOTH' } }),
        wait(1),
      ),
    ),
  ]),
};

/** Exercises most core emitters: variables, functions, branches, loops, text, maths, serial. */
const nightLight: ExampleProject = {
  name: 'night-light',
  title: 'Night light',
  description: 'Read a light sensor on A0, dim an LED with PWM, and report the level over Serial.',
  kit: 'Starter',
  boards: ['tariro', 'malkon-one', 'arduino-uno', 'arduino-mega'],
  workspace: workspace(
    [
      program(
        set('count', n(0)),
        block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: t('Night light ready') } }),
        block('procedures_callnoreturn', { extraState: { name: 'beep', params: ['times'] }, inputs: { ARG0: n(2) } }),
        forever(
          set('level', block('io_analog_read', { fields: { PIN: 'A0' } })),
          block('io_pwm_write', {
            fields: { PIN: '3' },
            inputs: {
              VALUE: block('procedures_callreturn', { extraState: { name: 'brightness', params: ['reading'] }, inputs: { ARG0: v('level') } }),
            },
          }),
          block('controls_if', {
            extraState: { hasElse: true },
            inputs: { IF0: block('logic_compare', { fields: { OP: 'LT' }, inputs: { A: v('level'), B: n(300) } }) },
            do: {
              DO0: [block('io_digital_write', { fields: { PIN: '13', STATE: 'HIGH' } })],
              ELSE: [block('io_digital_write', { fields: { PIN: '13', STATE: 'LOW' } })],
            },
          }),
          block('math_change', { fields: { VAR: { id: 'count' } }, inputs: { DELTA: n(1) } }),
          block('controls_if', {
            inputs: {
              IF0: block('logic_compare', {
                fields: { OP: 'EQ' },
                inputs: { A: block('math_modulo', { inputs: { DIVIDEND: v('count'), DIVISOR: n(10) } }), B: n(0) },
              }),
            },
            do: {
              DO0: [
                set('message', block('text_join', { extraState: { itemCount: 2 }, inputs: { ADD0: t('light level: '), ADD1: v('level') } })),
                block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: v('message') } }),
              ],
            },
          }),
          block('controls_whileUntil', {
            fields: { MODE: 'WHILE' },
            inputs: { BOOL: block('serial_available') },
            do: { DO: [block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: block('serial_read_line') } })] },
          }),
          block('tariro_wait_ms', { inputs: { MS: n(100) } }),
        ),
      ),
      block('procedures_defreturn', {
        fields: { NAME: 'brightness' },
        extraState: { params: [{ name: 'reading', id: 'reading' }] },
        inputs: {
          RETURN: block('math_constrain', {
            inputs: {
              VALUE: block('math_arithmetic', {
                fields: { OP: 'MINUS' },
                inputs: {
                  A: n(255),
                  B: block('math_arithmetic', {
                    fields: { OP: 'DIVIDE' },
                    inputs: { A: v('reading'), B: n(4) },
                  }),
                },
              }),
              LOW: n(0),
              HIGH: n(255),
            },
          }),
        },
      }),
      block('procedures_defnoreturn', {
        fields: { NAME: 'beep' },
        extraState: { params: [{ name: 'times', id: 'times' }] },
        do: {
          STACK: [
            block('controls_repeat_ext', {
              inputs: { TIMES: v('times') },
              do: {
                DO: [
                  block('io_tone', { fields: { PIN: '8' }, inputs: { FREQUENCY: n(880), DURATION: n(100) } }),
                  block('tariro_wait_ms', { inputs: { MS: n(200) } }),
                ],
              },
            }),
          ],
        },
      }),
    ],
    [
      { id: 'count', name: 'count' },
      { id: 'level', name: 'light level' },
      { id: 'message', name: 'message' },
      { id: 'reading', name: 'reading' },
      { id: 'times', name: 'times' },
    ],
  ),
};

import { KIT_EXAMPLES } from './examples-kits.js';
import { ROBOTICS_EXAMPLES } from './examples-robotics.js';

export const EXAMPLES: ExampleProject[] = [blink, tariroMotors, nightLight, ...KIT_EXAMPLES, ...ROBOTICS_EXAMPLES];
