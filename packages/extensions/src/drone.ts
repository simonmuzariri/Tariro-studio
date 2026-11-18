/**
 * Drone Studio blocks (Phase 6a). They fly a drone from this computer: the simulator now, a DJI
 * Tello over Wi-Fi later (6b), with the same commands. There is no board code: these blocks only
 * run live, through `ctx.drone()`, inside a program started by "when the drone program starts".
 *
 * The pack is offered to no board (`boards: []`), so it never appears in the Arduino toolbox; Drone
 * Studio builds its own toolbox (`droneToolbox`) from these categories and the general ones.
 */
import { DRONE_START, type DroneFlip, type DroneMove, type DroneTurn, type ExperienceLevel, type ExtensionManifest, type LiveContext, type LiveHandler, type ToolboxCategorySpec, type WorkspaceJson } from '@tariro-studio/core';
import { coreExtension } from './core-blocks.js';
import { dropdown, num, STATEMENT, valueIn } from './util.js';

const STYLE = 'drone_blocks';
const VALUE = { output: null, inputsInline: true } as const;

const blocks: ExtensionManifest['blocks'] = [
  {
    type: DRONE_START,
    json: {
      type: DRONE_START,
      message0: 'when the drone program starts %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      style: 'events_blocks',
      hat: 'cap',
      tooltip: 'The flight starts here when you press Fly.',
    },
  },
  {
    type: 'drone_takeoff',
    json: { type: 'drone_takeoff', message0: 'take off', ...STATEMENT, style: STYLE, tooltip: 'Start the motors and rise to about 80 cm, then hover.' },
  },
  {
    type: 'drone_land',
    json: { type: 'drone_land', message0: 'land', ...STATEMENT, style: STYLE, tooltip: 'Come down slowly where the drone is and stop the motors.' },
  },
  {
    type: 'drone_move',
    json: {
      type: 'drone_move',
      message0: 'fly %1 %2 cm',
      args0: [
        dropdown('DIR', [
          ['forward', 'forward'],
          ['back', 'back'],
          ['left', 'left'],
          ['right', 'right'],
          ['up', 'up'],
          ['down', 'down'],
        ]),
        valueIn('CM', 'Number'),
      ],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Fly a distance (20 to 500 cm) the way the drone is facing, then hover.',
    },
  },
  {
    type: 'drone_turn',
    json: {
      type: 'drone_turn',
      message0: 'turn %1 %2 degrees',
      args0: [dropdown('DIR', [['right ↻', 'right'], ['left ↺', 'left']]), valueIn('DEG', 'Number')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Turn on the spot (1 to 360 degrees).',
    },
  },
  {
    type: 'drone_flip',
    json: {
      type: 'drone_flip',
      message0: 'flip %1',
      args0: [dropdown('DIR', [['forward', 'forward'], ['back', 'back'], ['left', 'left'], ['right', 'right']])],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'A somersault in the air. Needs 50 % battery and 60 cm of height.',
    },
  },
  {
    type: 'drone_speed',
    json: { type: 'drone_speed', message0: 'set flying speed to %1 cm/s', args0: [valueIn('SPEED', 'Number')], ...STATEMENT, style: STYLE, tooltip: 'Speed for the next moves, 10 to 100 cm/s.' },
  },
  {
    type: 'drone_hover',
    json: { type: 'drone_hover', message0: 'hover for %1 seconds', args0: [valueIn('SECONDS', 'Number')], ...STATEMENT, style: STYLE, tooltip: 'Stay in the air where the drone is.' },
  },
  {
    type: 'drone_emergency',
    json: { type: 'drone_emergency', message0: 'emergency: stop the motors', ...STATEMENT, style: STYLE, tooltip: 'Cut the motors at once. The drone falls: use only to prevent harm.' },
  },
  {
    type: 'drone_reading',
    json: {
      type: 'drone_reading',
      message0: 'drone %1',
      args0: [
        dropdown('WHAT', [
          ['height (cm)', 'height'],
          ['battery (%)', 'battery'],
          ['heading (°)', 'heading'],
          ['distance from start (cm)', 'distance'],
          ['x (cm)', 'x'],
          ['y (cm)', 'y'],
          ['flight time (s)', 'time'],
        ]),
      ],
      ...VALUE,
      output: 'Number',
      style: STYLE,
      tooltip: 'A reading from the drone.',
    },
  },
  {
    type: 'drone_flying',
    json: { type: 'drone_flying', message0: 'drone is flying?', ...VALUE, output: 'Boolean', style: STYLE, tooltip: 'True while the drone is in the air.' },
  },
];

const statement = (run: (ctx: LiveContext) => Promise<void>): LiveHandler => ({ kind: 'statement', run });

const live: Record<string, LiveHandler> = {
  drone_takeoff: statement((ctx) => ctx.drone().takeoff()),
  drone_land: statement((ctx) => ctx.drone().land()),
  drone_move: statement(async (ctx) => ctx.drone().move(ctx.field('DIR') as DroneMove, await ctx.number('CM', 50))),
  drone_turn: statement(async (ctx) => ctx.drone().turn(ctx.field('DIR') as DroneTurn, await ctx.number('DEG', 90))),
  drone_flip: statement((ctx) => ctx.drone().flip(ctx.field('DIR') as DroneFlip)),
  drone_speed: statement(async (ctx) => ctx.drone().setSpeed(await ctx.number('SPEED', 50))),
  drone_hover: statement(async (ctx) => {
    if (!ctx.drone().state().flying) ctx.fail('Take off first: the drone is on the ground.');
    await ctx.wait((await ctx.number('SECONDS', 1)) * 1000);
  }),
  drone_emergency: statement((ctx) => ctx.drone().emergency()),
  drone_reading: {
    kind: 'value',
    run: async (ctx) => {
      const s = ctx.drone().state();
      const round = (v: number) => Math.round(v * 10) / 10;
      switch (ctx.field('WHAT')) {
        case 'height':
          return round(s.z);
        case 'battery':
          return Math.round(s.battery);
        case 'heading':
          return Math.round(s.heading);
        case 'distance':
          return round(Math.hypot(s.x, s.y));
        case 'x':
          return round(s.x);
        case 'y':
          return round(s.y);
        case 'time':
          return round(s.flightTime);
        default:
          return 0;
      }
    },
  },
  drone_flying: { kind: 'value', run: async (ctx) => ctx.drone().state().flying },
};

const DRONE_CATEGORIES: ToolboxCategorySpec[] = [
  {
    id: 'drone-start',
    name: 'Start',
    style: 'events_category',
    contents: [{ kind: 'block', type: DRONE_START }],
  },
  {
    id: 'drone',
    name: 'Drone',
    style: 'drone_category',
    contents: [
      { kind: 'block', type: 'drone_takeoff' },
      { kind: 'block', type: 'drone_land' },
      { kind: 'sep' },
      { kind: 'block', type: 'drone_move', fields: { DIR: 'forward' }, inputs: { CM: num(100) } },
      { kind: 'block', type: 'drone_move', fields: { DIR: 'up' }, inputs: { CM: num(50) } },
      { kind: 'block', type: 'drone_turn', inputs: { DEG: num(90) } },
      { kind: 'block', type: 'drone_hover', inputs: { SECONDS: num(2) } },
      { kind: 'sep' },
      { kind: 'block', type: 'drone_speed', level: 'intermediate', inputs: { SPEED: num(50) } },
      { kind: 'block', type: 'drone_flip', level: 'intermediate' },
      { kind: 'block', type: 'drone_emergency', level: 'intermediate' },
      { kind: 'sep' },
      { kind: 'block', type: 'drone_reading' },
      { kind: 'block', type: 'drone_flying', level: 'intermediate' },
    ],
  },
];

export const droneExtension: ExtensionManifest = {
  id: 'drone',
  name: 'Drone',
  version: '0.1.0',
  category: 'core',
  description: 'Fly a drone from this computer: take off, move, turn, flip and land, in the simulator (a DJI Tello later).',
  // Offered to no board: Drone Studio has its own toolbox.
  boards: [],
  blocks,
  toolbox: DRONE_CATEGORIES,
  emitters: {},
  live,
};

/** Drone Studio's toolbox: the drone's own categories, then loops, maths, variables and functions. */
export function droneToolbox(level: ExperienceLevel = 'advanced'): ToolboxCategorySpec[] {
  const general = coreExtension.toolbox.filter((c) => c.id !== 'events').map((c) => (c.id === 'control' ? { ...c, contents: c.contents.filter((i) => i.kind !== 'block' || (i.type !== 'tariro_forever' && i.type !== 'tariro_millis')) } : c));
  const rank = ['beginner', 'intermediate', 'advanced'].indexOf(level);
  const shown = (l: ExperienceLevel | undefined) => !l || ['beginner', 'intermediate', 'advanced'].indexOf(l) <= rank;
  return [...DRONE_CATEGORIES, ...general]
    .filter((c) => shown(c.level))
    .map((c) => ({ ...c, contents: c.contents.filter((i) => i.kind !== 'block' || shown(i.level)) }));
}

/** A first flight: take off, a square at 1 m, land. */
export const DRONE_STARTER: WorkspaceJson = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: DRONE_START,
        id: 'start',
        x: 40,
        y: 40,
        inputs: {
          DO: {
            block: {
              type: 'drone_takeoff',
              id: 'takeoff',
              next: {
                block: {
                  type: 'controls_repeat_ext',
                  id: 'square',
                  inputs: {
                    TIMES: { shadow: { type: 'math_number', id: 'times', fields: { NUM: 4 } } },
                    DO: {
                      block: {
                        type: 'drone_move',
                        id: 'side',
                        fields: { DIR: 'forward' },
                        inputs: { CM: { shadow: { type: 'math_number', id: 'cm', fields: { NUM: 100 } } } },
                        next: { block: { type: 'drone_turn', id: 'corner', fields: { DIR: 'right' }, inputs: { DEG: { shadow: { type: 'math_number', id: 'deg', fields: { NUM: 90 } } } } } },
                      },
                    },
                  },
                  next: { block: { type: 'drone_land', id: 'land' } },
                },
              },
            },
          },
        },
      },
    ],
  },
};
