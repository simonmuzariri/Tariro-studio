import { describe, expect, it } from 'vitest';
import { CreativeRuntime, getBoard, type Stage } from '@tariro-studio/core';
import { createRegistry, STAGE_BOARD_BLOCKS, stageBoardHandlers, stageBoardToolbox, type StageBoardIO } from '../src/index.js';

const registry = createRegistry();
const tariro = getBoard('tariro');

function fakeBoard(inputs: { digital?: Record<number, boolean>; analog?: Record<number, number> } = {}) {
  const log: string[] = [];
  const io: StageBoardIO = {
    digitalWrite: (p, on) => void log.push(`${p}=${on ? 1 : 0}`),
    analogWrite: (p, v) => void log.push(`${p}~${v}`),
    servoWrite: (p, a) => void log.push(`${p}^${a}`),
    digitalRead: (p) => inputs.digital?.[p] ?? false,
    analogRead: (c) => inputs.analog?.[c] ?? 0,
  };
  return { io, log };
}

type B = Record<string, unknown>;
const blk = (type: string, fields: B = {}, inputs: Record<string, B> = {}, next?: B): B => ({
  type,
  id: `${type}-${Math.random().toString(36).slice(2, 7)}`,
  fields,
  inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { block: v }])),
  ...(next ? { next: { block: next } } : {}),
});
const n = (v: number) => blk('math_number', { NUM: v });
const stageWith = (...scripts: B[]): Stage => ({
  backdrops: ['plain'],
  backdrop: 0,
  sprites: [{ id: 'tari', name: 'Tari', costumes: ['tari-a'], costume: 0, x: 0, y: 0, direction: 90, size: 100, visible: true, workspace: { blocks: { blocks: scripts } } }],
});

describe('Stage mode: board blocks in sprite programs', () => {
  it('a sprite script turns an LED on and drives the Tariro motors', () => {
    const b = fakeBoard();
    const script = blk(
      'cs_when_flag',
      {},
      {},
      blk('basic_led', { PIN: '13', STATE: 'ON' }, {}, blk('tariro_motor_run', { MOTOR: 'A', DIRECTION: 'FORWARD' }, { SPEED: n(50) }, blk('tariro_motor_stop', { MOTOR: 'BOTH' }))),
    );
    const rt = new CreativeRuntime(stageWith(script), { board: stageBoardHandlers(b.io, tariro) });
    rt.greenFlag();
    rt.step(16);
    expect(rt.problems).toEqual([]);
    expect(b.log[0]).toBe('13=1');
    expect(b.log.length).toBeGreaterThan(3); // the motor pins of the Tariro driver
  });

  it('sensor readings steer the sprite: a pressed button makes it move', () => {
    const b = fakeBoard({ digital: { 2: false } }); // pull-up input reads LOW = pressed
    const script = blk(
      'cs_when_flag',
      {},
      {},
      blk('cs_forever', {}, {}, undefined),
    );
    (script['next'] as { block: B }).block['inputs'] = {
      DO: { block: blk('controls_if', {}, { IF0: blk('sensor_button_pressed', { PIN: '2' }) }) },
    };
    const ifBlock = ((script['next'] as { block: B }).block['inputs'] as Record<string, { block: B }>)['DO']!.block;
    (ifBlock['inputs'] as Record<string, unknown>)['DO0'] = { block: blk('cs_change_x', {}, { DX: n(5) }) };
    const rt = new CreativeRuntime(stageWith(script), { board: stageBoardHandlers(b.io, tariro) });
    rt.greenFlag();
    for (let i = 0; i < 4; i++) rt.step(33);
    expect(rt.view().sprites[0]!.x).toBe(20);
  });

  it('an analog level becomes 0–100 like the uploaded program', () => {
    const b = fakeBoard({ analog: { 0: 1023 } });
    const script = blk('cs_when_flag', {}, {}, blk('cs_set_x', {}, { X: blk('sensor_analog_level', { SENSOR: 'POT', PIN: 'A0' }) }));
    const rt = new CreativeRuntime(stageWith(script), { board: stageBoardHandlers(b.io, tariro) });
    rt.greenFlag();
    rt.step(16);
    expect(rt.view().sprites[0]!.x).toBe(100);
  });

  it('a wrong pin is reported on the sprite instead of crashing the stage', () => {
    const b = fakeBoard();
    const script = blk('cs_when_flag', {}, {}, blk('io_analog_read_as_statement'));
    const bad = blk('cs_when_flag', {}, {}, blk('cs_set_x', {}, { X: blk('io_analog_read', { PIN: '7' }) }));
    const rt = new CreativeRuntime(stageWith(script, bad), { board: stageBoardHandlers(b.io, tariro) });
    rt.greenFlag();
    rt.step(16);
    expect(rt.problems.map((p) => p.message)).toContain('Pin 7 is not an analog pin.');
  });

  it('every stage board block has a handler, and the Stage toolbox offers only those', () => {
    const handlers = stageBoardHandlers(fakeBoard().io, tariro);
    for (const t of STAGE_BOARD_BLOCKS) expect(handlers[t], t).toBeDefined();
    const cats = stageBoardToolbox(registry, tariro, [], 'advanced');
    const types = cats.flatMap((c) => c.contents.flatMap((i) => (i.kind === 'block' ? [i.type] : [])));
    expect(types.length).toBeGreaterThan(8);
    for (const t of types) expect(STAGE_BOARD_BLOCKS as readonly string[], t).toContain(t);
    expect(cats.map((c) => c.id)).toEqual(expect.arrayContaining(['pins', 'tariro', 'basic']));
    expect(cats.map((c) => c.id)).not.toContain('control');
  });
});
