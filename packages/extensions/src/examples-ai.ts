/**
 * Stage mode example for Phase 5b: the AI decides, the robot moves (through the safety layer).
 */
import { defaultStage, newImageModel, type ImageModel, type Stage } from '@tariro-studio/core';
import type { ExampleProject } from './examples.js';
import { block, forever, n, program, workspace } from './build.js';

type B = Record<string, unknown>;
let counter = 0;
const id = (t: string) => `${t}-${++counter}`;
const blk = (type: string, extra: B = {}): B => ({ type, id: id(type), ...extra });
const num = (v: number) => ({ shadow: { type: 'math_number', id: id('n'), fields: { NUM: v } } });
const txt = (v: string) => ({ shadow: { type: 'text', id: id('t'), fields: { TEXT: v } } });
function seq(...bs: B[]): B {
  for (let i = bs.length - 2; i >= 0; i--) bs[i]!['next'] = { block: bs[i + 1] };
  return bs[0]!;
}

const sees = (cls: string) => blk('ai_is', { fields: { CLASS: cls } });
const drive = blk('tariro_drive', { fields: { MOVE: 'FORWARD' }, inputs: { SPEED: num(40) } });
const stopMotors = () => blk('tariro_motor_stop', { fields: { MOTOR: 'BOTH' } });

/** Green: go (with the running animation). Red: stop. Not sure: stop, to be safe. */
const loopBody = blk('controls_if', {
  extraState: { elseIfCount: 1, hasElse: true },
  inputs: {
    IF0: { block: sees('Green') },
    DO0: { block: seq(drive, blk('cs_say', { inputs: { TEXT: txt('Green: go!') } }), blk('cs_next_in_group', { fields: { GROUP: 'run' } })) },
    IF1: { block: sees('Red') },
    DO1: { block: seq(stopMotors(), blk('cs_say', { inputs: { TEXT: txt('Red: stop!') } }), blk('cs_costume', { fields: { COSTUME: 'tariro-idle-1' } })) },
    ELSE: { block: seq(stopMotors(), blk('cs_say', { inputs: { TEXT: txt('I am not sure, so I wait.') } }), blk('cs_costume', { fields: { COSTUME: 'tariro-think-1' } })) },
  },
});

const script = {
  ...blk('cs_when_flag'),
  x: 30,
  y: 30,
  next: {
    block: seq(
      blk('ai_video', { fields: { MODE: 'ON' } }),
      blk('cs_forever', { inputs: { DO: { block: seq(loopBody, blk('cs_wait', { inputs: { SECS: num(0.1) } })) } } }),
    ),
  },
};

const stage: Stage = (() => {
  const s = defaultStage();
  s.backdrops = ['plain', 'grid'];
  s.sprites[0]!.x = 150;
  s.sprites[0]!.y = -100;
  s.sprites[0]!.size = 70;
  s.sprites[0]!.workspace = { blocks: { languageVersion: 0, blocks: [script] } };
  return s;
})();

/** Colour following: the robot drives towards a red card and stops when it is close (no training needed). */
const followScript = {
  ...blk('cs_when_flag'),
  x: 30,
  y: 30,
  next: {
    block: seq(
      blk('ai_video', { fields: { MODE: 'ON' } }),
      blk('cs_forever', {
        inputs: {
          DO: {
            block: seq(
              blk('ai_colour_follow', { fields: { COLOUR: 'red' }, inputs: { SPEED: num(35), STOP: num(25) } }),
              blk('controls_if', {
                extraState: { hasElse: true },
                inputs: {
                  IF0: { block: blk('ai_colour_seen', { fields: { COLOUR: 'red' } }) },
                  DO0: { block: blk('cs_say', { inputs: { TEXT: txt('I see red: coming!') } }) },
                  ELSE: { block: blk('cs_say', { inputs: { TEXT: txt('Where is the red card?') } }) },
                },
              }),
              blk('cs_wait', { inputs: { SECS: num(0.1) } }),
            ),
          },
        },
      }),
    ),
  },
};

const followStage: Stage = (() => {
  const s = defaultStage();
  s.backdrops = ['plain', 'grid'];
  s.sprites[0]!.x = 150;
  s.sprites[0]!.y = -100;
  s.sprites[0]!.size = 70;
  s.sprites[0]!.workspace = { blocks: { languageVersion: 0, blocks: [followScript] } };
  return s;
})();

/** The three classes, named; the learner records the pictures with their own card. */
const ai: ImageModel = {
  classes: [
    { ...newImageModel().classes[0]!, name: 'Green' },
    { ...newImageModel().classes[1]!, name: 'Red' },
    { id: 'class-3', name: 'Nothing', samples: [] },
  ],
};

/** Wheel encoders on interrupt pins 2 and 3 (left, right), single channel. */
const encoders = () => [
  block('enc_setup', { fields: { ENCODER: 'LEFT', KIND: 'SINGLE', PIN_A: '2', PIN_B: '2' } }),
  block('enc_setup', { fields: { ENCODER: 'RIGHT', KIND: 'SINGLE', PIN_A: '3', PIN_B: '3' } }),
];

export const AUTONOMY_EXAMPLES: ExampleProject[] = [
  {
    name: 'autonomy-square',
    title: 'Drive a square, then stop at a wall',
    description: 'Uses the wheel encoders to drive 40 cm and turn 90° four times, then drives on until the ultrasonic sensor sees a wall.',
    kit: 'Robotics',
    boards: ['tariro'],
    workspace: workspace([
      program(
        ...encoders(),
        block('controls_repeat_ext', {
          inputs: { TIMES: n(4) },
          do: {
            DO: [
              block('auto_drive_cm', { inputs: { CM: n(40), SPEED: n(50) } }),
              block('auto_turn_deg', { fields: { DIR: 'RIGHT' }, inputs: { DEG: n(90), SPEED: n(40), TRACK: n(13) } }),
            ],
          },
        }),
        block('auto_until_obstacle', { fields: { TRIG: '12', ECHO: '13' }, inputs: { SPEED: n(45), CM: n(15) } }),
      ),
    ]),
  },
  {
    name: 'autonomy-hold-speed',
    title: 'Hold a steady speed',
    description: 'Each wheel measures its own speed with its encoder and adjusts its motor (PI control), so both wheels keep 60 RPM on carpet, on a slope or with a weaker motor.',
    kit: 'Robotics',
    boards: ['tariro'],
    workspace: workspace([program(...encoders(), forever(block('auto_hold_speed', { fields: { DIR: 'FORWARD' }, inputs: { RPM: n(60), MAX: n(80) } }), block('tariro_wait_ms', { inputs: { MS: n(20) } })))]),
  },
  {
    name: 'autonomy-line-follower',
    title: 'Follow a black line',
    description: 'Two line sensors either side of a dark line: the robot steers back onto it, and searches the way it last saw it.',
    kit: 'Robotics',
    boards: ['tariro'],
    workspace: workspace([program(forever(block('auto_follow_line', { fields: { LEFT: '8', RIGHT: '9' }, inputs: { SPEED: n(40) } })))]),
  },
];

export const AI_EXAMPLES: ExampleProject[] = [
  {
    name: 'ai-traffic-light-car',
    title: 'AI traffic-light car',
    description: 'Teach the AI a green and a red card; the Tariro robot drives on green and stops on red (Stage mode).',
    kit: 'Robotics',
    boards: ['tariro'],
    // The Upload-mode program stays the plain starter; this example lives on the stage.
    workspace: workspace([program()]),
    stage,
    ai,
    opensIn: 'stage',
  },
  {
    name: 'ai-colour-follow-car',
    title: 'AI colour-following car',
    description: 'The Tariro robot drives towards a red card and stops when it is close (Stage mode, camera on the robot looking forward). No training needed.',
    kit: 'Robotics',
    boards: ['tariro'],
    workspace: workspace([program()]),
    stage: followStage,
    opensIn: 'stage',
  },
];
