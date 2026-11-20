/**
 * Creative Studio blocks (our own wording and layout). Dropdowns that depend on the project
 * (costumes, other sprites, backdrops) read the stage being edited through `creativeContext`.
 */
import * as Blockly from 'blockly';
import { backdropById, COLOUR_NAMES, costumeById, costumeGroups, POSE_POINTS, SOUNDS, type Stage } from '@tariro-studio/core';

export const creativeContext: { stage: Stage | null; spriteId: string | null; aiClasses: string[]; gestureClasses: string[]; soundClasses: string[] } = { stage: null, spriteId: null, aiClasses: [], gestureClasses: [], soundClasses: [] };

type Source = 'touch' | 'place' | 'towards' | 'costumes' | 'groups' | 'backdrops' | 'sounds' | 'keys' | 'classes' | 'colours' | 'points' | 'gestures' | 'heard';

const KEYS = ['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'any', ...'abcdefghijklmnopqrstuvwxyz'.split(''), ...'0123456789'.split('')];

function options(source: Source): Array<[string, string]> {
  const stage = creativeContext.stage;
  const others = (stage?.sprites ?? []).filter((s) => s.id !== creativeContext.spriteId).map((s) => [s.name, s.id] as [string, string]);
  switch (source) {
    case 'touch':
      return [['edge', '_edge'], ['mouse-pointer', '_mouse'], ...others];
    case 'place':
      return [['random position', '_random'], ['mouse-pointer', '_mouse'], ...others];
    case 'towards':
      return [['mouse-pointer', '_mouse'], ...others];
    case 'costumes': {
      const s = stage?.sprites.find((x) => x.id === creativeContext.spriteId);
      return (s?.costumes ?? ['tari-a']).map((id) => [costumeById(id)?.name ?? id, id]);
    }
    case 'groups': {
      const s = stage?.sprites.find((x) => x.id === creativeContext.spriteId);
      const groups = costumeGroups(s?.costumes ?? []);
      const label = (g: string) => (g === 'getup' ? 'get up' : g);
      return groups.length ? groups.map((g) => [label(g), g]) : [['(this sprite has no moves)', 'none']];
    }
    case 'backdrops':
      return (stage?.backdrops ?? ['plain']).map((id) => [backdropById(id)?.name ?? id, id]);
    case 'sounds':
      return SOUNDS.map((s) => [s.name, s.id]);
    case 'keys':
      return KEYS.map((k) => [k, k]);
    case 'classes':
      return creativeContext.aiClasses.length ? creativeContext.aiClasses.map((c) => [c, c]) : [['(train a model first)', '']];
    case 'colours':
      return COLOUR_NAMES.map((c) => [c, c]);
    case 'points':
      return POSE_POINTS.map((p) => [p, p]);
    case 'gestures':
      return creativeContext.gestureClasses.length ? creativeContext.gestureClasses.map((c) => [c, c]) : [['(teach gestures first)', '']];
    case 'heard':
      return creativeContext.soundClasses.length ? creativeContext.soundClasses.map((c) => [c, c]) : [['(teach sounds first)', '']];
  }
}

class FieldChoice extends Blockly.FieldDropdown {
  constructor(
    private readonly source: Source,
    value?: string,
  ) {
    super(() => options(source));
    if (value !== undefined) this.setValue(value);
  }
  static override fromJson(o: Blockly.FieldDropdownFromJsonConfig): FieldChoice {
    const c = o as { source?: Source; value?: string };
    return new FieldChoice(c.source ?? 'keys', c.value);
  }
  /** Keep a value that is not offered now (a sprite that was renamed or removed stays readable). */
  protected override doClassValidation_(v?: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
  }
  protected override getText_(): string | null {
    const v = this.getValue();
    if (v === null) return null;
    return options(this.source).find(([, id]) => id === v)?.[0] ?? (v.startsWith('_') ? v.slice(1) : v);
  }
}

const choice = (name: string, source: Source, value?: string) => ({ type: 'field_cs_choice', name, source, ...(value ? { value } : {}) });
const num = (name: string) => ({ type: 'input_value', name, check: ['Number', 'String'] });
const txt = (name: string) => ({ type: 'input_value', name });
const cond = (name: string) => ({ type: 'input_value', name, check: 'Boolean' });
const stmt = { previousStatement: null, nextStatement: null };
const hat = { nextStatement: null };

type Def = Record<string, unknown> & { type: string };
const def = (type: string, style: string, message0: string, args0: unknown[], shape: object, tooltip: string, extra: object = {}): Def => ({
  type,
  message0,
  args0,
  ...shape,
  style,
  tooltip,
  ...extra,
});

const E = 'events_blocks';
const M = 'motion_blocks';
const L = 'looks_blocks';
const S = 'sound_blocks';
const C = 'loop_blocks';
const SE = 'sensing_blocks';
const value = (check: string) => ({ output: check });
const V = 'vision_blocks';

export const CREATIVE_BLOCKS: Def[] = [
  def('cs_when_flag', E, 'when %1 clicked', [{ type: 'field_label_serializable', name: 'FLAG', text: '▶ green flag' }], hat, 'Runs when the green flag is clicked.'),
  def('cs_when_key', E, 'when %1 key pressed', [choice('KEY', 'keys', 'space')], hat, 'Runs each time this key is pressed.'),
  def('cs_when_clicked', E, 'when this sprite is clicked', [], hat, 'Runs when the sprite is clicked on the stage.'),
  def('cs_when_receive', E, 'when I receive %1', [{ type: 'field_input', name: 'MESSAGE', text: 'go' }], hat, 'Runs when any sprite broadcasts this message.'),
  def('cs_broadcast', E, 'broadcast %1', [{ type: 'field_input', name: 'MESSAGE', text: 'go' }], stmt, 'Send a message to every sprite.'),
  def('cs_broadcast_wait', E, 'broadcast %1 and wait', [{ type: 'field_input', name: 'MESSAGE', text: 'go' }], stmt, 'Send a message and wait until every script it started has finished.'),

  def('cs_move', M, 'move %1 steps', [num('STEPS')], stmt, 'Move forward in the direction the sprite faces.'),
  def('cs_turn_right', M, 'turn ↻ %1 degrees', [num('DEG')], stmt, 'Turn clockwise.'),
  def('cs_turn_left', M, 'turn ↺ %1 degrees', [num('DEG')], stmt, 'Turn anticlockwise.'),
  def('cs_goto', M, 'go to %1', [choice('TARGET', 'place', '_random')], stmt, 'Jump to a place.'),
  def('cs_goto_xy', M, 'go to x: %1 y: %2', [num('X'), num('Y')], stmt, 'Jump to a point. The stage goes from x -240 to 240 and y -180 to 180.'),
  def('cs_glide_xy', M, 'glide %1 secs to x: %2 y: %3', [num('SECS'), num('X'), num('Y')], stmt, 'Slide smoothly to a point.'),
  def('cs_point', M, 'point in direction %1', [num('DIR')], stmt, '0 = up, 90 = right, 180 = down, -90 = left.'),
  def('cs_point_towards', M, 'point towards %1', [choice('TARGET', 'towards', '_mouse')], stmt, 'Face the mouse pointer or another sprite.'),
  def('cs_change_x', M, 'change x by %1', [num('DX')], stmt, 'Move left (negative) or right.'),
  def('cs_set_x', M, 'set x to %1', [num('X')], stmt, 'Set the left–right position.'),
  def('cs_change_y', M, 'change y by %1', [num('DY')], stmt, 'Move down (negative) or up.'),
  def('cs_set_y', M, 'set y to %1', [num('Y')], stmt, 'Set the up–down position.'),
  def('cs_bounce', M, 'if on edge, bounce', [], stmt, 'Turn round when touching the edge of the stage.'),
  def('cs_x', M, 'x position', [], value('Number'), 'Left–right position.'),
  def('cs_y', M, 'y position', [], value('Number'), 'Up–down position.'),
  def('cs_direction', M, 'direction', [], value('Number'), 'The direction the sprite faces.'),

  def('cs_say_for', L, 'say %1 for %2 seconds', [txt('TEXT'), num('SECS')], stmt, 'Show a speech bubble, then remove it.'),
  def('cs_say', L, 'say %1', [txt('TEXT')], stmt, 'Show a speech bubble (say nothing to remove it).'),
  def('cs_think', L, 'think %1', [txt('TEXT')], stmt, 'Show a thought bubble.'),
  def('cs_costume', L, 'switch costume to %1', [choice('COSTUME', 'costumes')], stmt, 'Change how the sprite looks.'),
  def('cs_next_costume', L, 'next costume', [], stmt, 'Go to the next costume (after the last comes the first).'),
  def('cs_next_in_group', L, 'next costume in %1', [choice('GROUP', 'groups', 'walk')], stmt, 'Animate one movement: steps through its poses (walk 1, walk 2…) and back to the first.'),
  def('cs_backdrop', L, 'switch backdrop to %1', [choice('BACKDROP', 'backdrops')], stmt, 'Change the stage background.'),
  def('cs_next_backdrop', L, 'next backdrop', [], stmt, 'Go to the next backdrop.'),
  def('cs_change_size', L, 'change size by %1', [num('D')], stmt, 'Grow (positive) or shrink, in percent.'),
  def('cs_set_size', L, 'set size to %1 %%', [num('SIZE')], stmt, '100 % is the normal size.'),
  def('cs_show', L, 'show', [], stmt, 'Make the sprite visible.'),
  def('cs_hide', L, 'hide', [], stmt, 'Make the sprite invisible.'),
  def('cs_front', L, 'go to front layer', [], stmt, 'Draw this sprite above the others.'),
  def('cs_costume_number', L, 'costume number', [], value('Number'), 'Which costume the sprite is wearing (1 = first).'),
  def('cs_size', L, 'size', [], value('Number'), 'The size in percent.'),

  def('cs_play', S, 'start sound %1', [choice('SOUND', 'sounds', 'pop')], stmt, 'Play a sound and carry on at once.'),
  def('cs_play_wait', S, 'play sound %1 until done', [choice('SOUND', 'sounds', 'pop')], stmt, 'Play a sound and wait for it to end.'),
  def('cs_note', S, 'play note %1 for %2 seconds', [num('NOTE'), num('SECS')], stmt, 'Play a note: 60 is middle C, 62 is D, 64 is E…'),

  def('cs_wait', C, 'wait %1 seconds', [num('SECS')], stmt, 'Pause this script.'),
  def('cs_forever', C, 'forever %1 %2', [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], { previousStatement: null }, 'Repeat the blocks inside until the program stops.'),
  def('cs_repeat', C, 'repeat %1 %2 %3', [num('TIMES'), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], stmt, 'Repeat the blocks inside a number of times.'),
  def('cs_repeat_until', C, 'repeat until %1 %2 %3', [cond('COND'), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], stmt, 'Repeat until the condition is true.'),
  def('cs_wait_until', C, 'wait until %1', [cond('COND')], stmt, 'Pause until the condition is true.'),
  def('cs_stop', C, 'stop %1', [{ type: 'field_dropdown', name: 'WHAT', options: [['all', 'ALL'], ['this script', 'THIS']] }], { previousStatement: null }, 'Stop everything, or just this script.'),

  def('cs_touching', SE, 'touching %1 ?', [choice('TARGET', 'touch', '_edge')], value('Boolean'), 'True when this sprite overlaps the edge, the mouse pointer or another sprite.'),
  def('cs_key_pressed', SE, 'key %1 pressed?', [choice('KEY', 'keys', 'space')], value('Boolean'), 'True while the key is held down.'),
  def('cs_mouse_down', SE, 'mouse down?', [], value('Boolean'), 'True while the mouse button is pressed on the stage.'),
  def('cs_mouse_x', SE, 'mouse x', [], value('Number'), 'The mouse pointer’s x on the stage.'),
  def('cs_mouse_y', SE, 'mouse y', [], value('Number'), 'The mouse pointer’s y on the stage.'),
  def('cs_distance_to', SE, 'distance to %1', [choice('TARGET', 'towards', '_mouse')], value('Number'), 'How far away, in steps.'),
  def('cs_timer', SE, 'timer', [], value('Number'), 'Seconds since the green flag (or the last reset).'),
  def('cs_reset_timer', SE, 'reset timer', [], stmt, 'Start the timer again from 0.'),

  def('ai_when', V, 'when AI sees %1', [choice('CLASS', 'classes')], hat, 'Runs each time the AI starts seeing this class (it must be at least 60 % sure).'),
  def('ai_video', V, 'turn video %1', [{ type: 'field_dropdown', name: 'MODE', options: [['on', 'ON'], ['on flipped', 'FLIPPED'], ['off', 'OFF']] }], stmt, 'Show the camera picture on the stage, behind the sprites.'),
  def('ai_label', V, 'AI sees', [], value('String'), 'The class the AI sees now, or nothing when it is not sure.'),
  def('ai_is', V, 'AI sees %1 ?', [choice('CLASS', 'classes')], value('Boolean'), 'True while the AI sees this class (at least 60 % sure).'),
  def('ai_confidence', V, 'confidence of %1 %%', [choice('CLASS', 'classes')], value('Number'), 'How sure the AI is that it sees this class, 0–100.'),

  def('ai_colour_seen', V, 'camera sees %1 ?', [choice('COLOUR', 'colours', 'red')], value('Boolean'), 'True while a patch of this colour is in the camera picture.'),
  def('ai_colour_x', V, 'x of %1', [choice('COLOUR', 'colours', 'red')], value('Number'), 'Where the colour is, left–right on the stage (0 when it is not seen).'),
  def('ai_colour_y', V, 'y of %1', [choice('COLOUR', 'colours', 'red')], value('Number'), 'Where the colour is, up–down on the stage (0 when it is not seen).'),
  def('ai_colour_size', V, 'size of %1 %%', [choice('COLOUR', 'colours', 'red')], value('Number'), 'How much of the picture has this colour, 0–100 %: bigger when the thing is closer.'),
  def('ai_marker_seen', V, 'marker %1 seen?', [num('ID')], value('Boolean'), 'True while this ArUco marker (0–1023) is in the camera picture.'),
  def('ai_marker_x', V, 'x of marker %1', [num('ID')], value('Number'), 'Where the marker is, left–right on the stage.'),
  def('ai_marker_y', V, 'y of marker %1', [num('ID')], value('Number'), 'Where the marker is, up–down on the stage.'),
  def('ai_marker_number', V, 'marker number seen', [], value('Number'), 'The number of a marker in the picture (the smallest if there are several), or -1 when there is none.'),
  def('ai_qr_text', V, 'QR code text', [], value('String'), 'The text of the QR code in the picture, or nothing.'),
  def('ai_body_seen', V, 'body seen?', [], value('Boolean'), 'True while the camera sees a person.'),
  def('ai_pose_x', V, 'x of %1', [choice('POINT', 'points', 'nose')], value('Number'), 'Where this body point is, left–right on the stage.'),
  def('ai_pose_y', V, 'y of %1', [choice('POINT', 'points', 'nose')], value('Number'), 'Where this body point is, up–down on the stage.'),
  def('ai_gesture_is', V, 'gesture is %1 ?', [choice('CLASS', 'gestures')], value('Boolean'), 'True while the AI sees this gesture (at least 60 % sure).'),
  def('ai_gesture', V, 'gesture', [], value('String'), 'The gesture the AI sees now, or nothing.'),
  def('ai_sound_is', S, 'hears %1 ?', [choice('CLASS', 'heard')], value('Boolean'), 'True while the AI hears this sound (at least 60 % sure).'),
  def('ai_sound', S, 'sound heard', [], value('String'), 'The sound the AI hears now, or nothing.'),
  def('ai_loudness', S, 'loudness', [], value('Number'), 'How loud the microphone is, 0–100.'),
];

let registered = false;
export function registerCreativeBlocks(): void {
  if (registered) return;
  registered = true;
  Blockly.fieldRegistry.register('field_cs_choice', FieldChoice as unknown as Blockly.fieldRegistry.RegistrableField);
  Blockly.common.defineBlocksWithJsonArray(CREATIVE_BLOCKS);
}

const N = (v: number) => ({ shadow: { type: 'math_number', fields: { NUM: v } } });
const T = (v: string) => ({ shadow: { type: 'text', fields: { TEXT: v } } });
const b = (type: string, inputs?: Record<string, unknown>, extra: object = {}) => ({ kind: 'block', type, ...(inputs ? { inputs } : {}), ...extra });

/** The Creative Studio toolbox (category ids pick the icons). */
export const CREATIVE_TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'Events', categorystyle: 'events_category', toolboxitemid: 'cs-events', contents: [b('cs_when_flag'), b('cs_when_key'), b('cs_when_clicked'), b('cs_when_receive'), b('cs_broadcast'), b('cs_broadcast_wait')] },
    {
      kind: 'category',
      name: 'Motion',
      categorystyle: 'motion_category',
      toolboxitemid: 'cs-motion',
      contents: [
        b('cs_move', { STEPS: N(10) }),
        b('cs_turn_right', { DEG: N(15) }),
        b('cs_turn_left', { DEG: N(15) }),
        b('cs_goto'),
        b('cs_goto_xy', { X: N(0), Y: N(0) }),
        b('cs_glide_xy', { SECS: N(1), X: N(100), Y: N(0) }),
        b('cs_point', { DIR: N(90) }),
        b('cs_point_towards'),
        b('cs_change_x', { DX: N(10) }),
        b('cs_set_x', { X: N(0) }),
        b('cs_change_y', { DY: N(10) }),
        b('cs_set_y', { Y: N(0) }),
        b('cs_bounce'),
        b('cs_x'),
        b('cs_y'),
        b('cs_direction'),
      ],
    },
    {
      kind: 'category',
      name: 'Looks',
      categorystyle: 'looks_category',
      toolboxitemid: 'cs-looks',
      contents: [
        b('cs_say_for', { TEXT: T('Hello!'), SECS: N(2) }),
        b('cs_say', { TEXT: T('Hello!') }),
        b('cs_think', { TEXT: T('Hmm…') }),
        b('cs_costume'),
        b('cs_next_costume'),
        b('cs_next_in_group'),
        b('cs_backdrop'),
        b('cs_next_backdrop'),
        b('cs_change_size', { D: N(10) }),
        b('cs_set_size', { SIZE: N(100) }),
        b('cs_show'),
        b('cs_hide'),
        b('cs_front'),
        b('cs_costume_number'),
        b('cs_size'),
      ],
    },
    { kind: 'category', name: 'Sound', categorystyle: 'sound_category', toolboxitemid: 'cs-sound', contents: [b('cs_play'), b('cs_play_wait'), b('cs_note', { NOTE: N(60), SECS: N(0.5) })] },
    {
      kind: 'category',
      name: 'Control',
      categorystyle: 'loop_category',
      toolboxitemid: 'cs-control',
      contents: [
        b('cs_wait', { SECS: N(1) }),
        b('cs_repeat', { TIMES: N(10) }),
        b('cs_forever'),
        b('controls_if'),
        b('controls_if', undefined, { extraState: { hasElse: true } }),
        b('cs_wait_until'),
        b('cs_repeat_until'),
        b('cs_stop'),
      ],
    },
    {
      kind: 'category',
      name: 'Sensing',
      categorystyle: 'sensing_category',
      toolboxitemid: 'cs-sensing',
      contents: [b('cs_touching'), b('cs_key_pressed'), b('cs_mouse_down'), b('cs_mouse_x'), b('cs_mouse_y'), b('cs_distance_to'), b('cs_timer'), b('cs_reset_timer')],
    },
    {
      kind: 'category',
      name: 'Operators',
      categorystyle: 'math_category',
      toolboxitemid: 'cs-operators',
      contents: [
        b('math_arithmetic', { A: N(1), B: N(1) }),
        b('math_random_int', { FROM: N(1), TO: N(10) }),
        b('logic_compare', { A: N(0), B: N(50) }),
        b('logic_operation'),
        b('logic_negate'),
        b('math_modulo', { DIVIDEND: N(10), DIVISOR: N(3) }),
        b('math_round', { NUM: N(3.6) }),
        b('text_join', { ADD0: T('apple '), ADD1: T('banana') }, { extraState: { itemCount: 2 } }),
        b('text_length', { VALUE: T('Tariro') }),
        b('math_number'),
        b('text'),
      ],
    },
    { kind: 'category', name: 'Variables', categorystyle: 'variable_category', toolboxitemid: 'cs-variables', custom: 'VARIABLE' },
    {
      kind: 'category',
      name: 'AI Vision',
      categorystyle: 'vision_category',
      toolboxitemid: 'cs-vision',
      contents: [
        { kind: 'button', text: 'Train an image model…', callbackKey: 'tariro-ai-train' },
        { kind: 'button', text: 'Open the AI Playground…', callbackKey: 'tariro-ai-playground' },
        b('ai_when'),
        b('ai_video'),
        b('ai_label'),
        b('ai_is'),
        b('ai_confidence'),
        { kind: 'label', text: 'Colours, markers and QR codes' },
        b('ai_colour_seen'),
        b('ai_colour_x'),
        b('ai_colour_y'),
        b('ai_colour_size'),
        b('ai_marker_seen', { ID: N(0) }),
        b('ai_marker_x', { ID: N(0) }),
        b('ai_marker_y', { ID: N(0) }),
        b('ai_marker_number'),
        b('ai_qr_text'),
        { kind: 'label', text: 'Body and gestures' },
        { kind: 'button', text: 'Teach gestures…', callbackKey: 'tariro-ai-gestures' },
        b('ai_body_seen'),
        b('ai_pose_x'),
        b('ai_pose_y'),
        b('ai_gesture_is'),
        b('ai_gesture'),
        { kind: 'label', text: 'Sounds' },
        { kind: 'button', text: 'Teach sounds…', callbackKey: 'tariro-ai-sounds' },
        b('ai_sound_is'),
        b('ai_sound'),
        b('ai_loudness'),
      ],
    },
  ],
} as unknown as Blockly.utils.toolbox.ToolboxDefinition;
