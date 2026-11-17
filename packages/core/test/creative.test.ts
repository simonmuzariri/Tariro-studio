import { describe, expect, it } from 'vitest';
import { BACKDROPS, COSTUMES, costumeGroups, CreativeRuntime, defaultStage, StageSchema, TARIRO_POSES, wrapDirection, type Stage } from '../src/index.js';

type B = Record<string, unknown>;
let ids = 0;
const blk = (type: string, opts: { fields?: B; inputs?: Record<string, B>; next?: B; do?: B[]; extraState?: unknown } = {}): B => {
  const out: B = { type, id: `${type}_${++ids}` };
  if (opts.fields) out['fields'] = opts.fields;
  const inputs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts.inputs ?? {})) inputs[k] = { block: v };
  if (opts.do) inputs['DO'] = { block: seq(...opts.do) };
  if (Object.keys(inputs).length) out['inputs'] = inputs;
  if (opts.extraState) out['extraState'] = opts.extraState;
  return out;
};
const n = (v: number) => blk('math_number', { fields: { NUM: v } });
const t = (v: string) => blk('text', { fields: { TEXT: v } });
/** Chain blocks with `next`. */
function seq(...bs: B[]): B {
  for (let i = bs.length - 2; i >= 0; i--) bs[i]!['next'] = { block: bs[i + 1] };
  return bs[0]!;
}
const script = (hat: B, ...body: B[]) => (body.length ? { ...hat, next: { block: seq(...body) } } : hat);
const sprite = (id: string, scripts: B[], extra: Partial<Stage['sprites'][number]> = {}): Stage['sprites'][number] => ({
  id,
  name: id,
  costumes: ['ball'],
  costume: 0,
  x: 0,
  y: 0,
  direction: 90,
  size: 100,
  visible: true,
  workspace: { blocks: { blocks: scripts } },
  ...extra,
});
const stage = (...sprites: Stage['sprites']): Stage => ({ backdrops: ['plain', 'sky'], backdrop: 0, sprites });
const flag = () => blk('cs_when_flag');
const run = (rt: CreativeRuntime, ms: number, frame = 1000 / 30) => {
  for (let tm = 0; tm < ms; tm += frame) rt.step(frame);
};
const at = (rt: CreativeRuntime, id: string) => rt.view().sprites.find((s) => s.id === id)!;

describe('Creative Studio runtime', () => {
  it('moves in the direction the sprite faces (90 = right, 0 = up) and turns', () => {
    const rt = new CreativeRuntime(stage(sprite('a', [script(flag(), blk('cs_move', { inputs: { STEPS: n(10) } }), blk('cs_turn_left', { inputs: { DEG: n(90) } }), blk('cs_move', { inputs: { STEPS: n(5) } }))])));
    rt.greenFlag();
    rt.step(16);
    const a = at(rt, 'a');
    expect(a.x).toBeCloseTo(10);
    expect(a.y).toBeCloseTo(5);
    expect(a.direction).toBe(0);
  });

  it('a forever loop runs one round per frame, so other scripts and Stop still work', () => {
    const rt = new CreativeRuntime(
      stage(
        sprite('a', [script(flag(), blk('cs_forever', { do: [blk('cs_change_x', { inputs: { DX: n(1) } })] }))]),
        sprite('b', [script(flag(), blk('cs_forever', { do: [blk('cs_change_y', { inputs: { DY: n(2) } })] }))]),
      ),
    );
    rt.greenFlag();
    for (let i = 0; i < 10; i++) rt.step(33);
    expect(at(rt, 'a').x).toBe(10);
    expect(at(rt, 'b').y).toBe(20);
    rt.stop();
    rt.step(33);
    expect(at(rt, 'a').x).toBe(10);
    expect(rt.busy).toBe(false);
  });

  it('waits and glides take their time in seconds', () => {
    const rt = new CreativeRuntime(stage(sprite('a', [script(flag(), blk('cs_wait', { inputs: { SECS: n(1) } }), blk('cs_glide_xy', { inputs: { SECS: n(2), X: n(100), Y: n(-50) } }))])));
    rt.greenFlag();
    run(rt, 900);
    expect(at(rt, 'a').x).toBe(0);
    run(rt, 1100); // 1 s into the glide: half way
    expect(at(rt, 'a').x).toBeGreaterThan(40);
    expect(at(rt, 'a').x).toBeLessThan(60);
    run(rt, 1200);
    expect(at(rt, 'a')).toMatchObject({ x: 100, y: -50 });
    expect(rt.busy).toBe(false);
  });

  it('say for seconds shows a bubble, then clears it; costumes and backdrops switch', () => {
    const rt = new CreativeRuntime(
      stage(
        sprite('tari', [script(flag(), blk('cs_say_for', { inputs: { TEXT: t('Hi'), SECS: n(1) } }), blk('cs_next_costume'), blk('cs_next_backdrop'))], { costumes: ['tari-a', 'tari-b'] }),
      ),
    );
    rt.greenFlag();
    rt.step(16);
    expect(at(rt, 'tari').say).toEqual({ text: 'Hi', think: false });
    run(rt, 1100);
    expect(at(rt, 'tari').say).toBeUndefined();
    expect(at(rt, 'tari').costume).toBe('tari-b');
    expect(rt.view().backdrop).toBe('sky');
  });

  it('bounces off the edges by mirroring the direction', () => {
    const rt = new CreativeRuntime(stage(sprite('a', [script(flag(), blk('cs_forever', { do: [blk('cs_move', { inputs: { STEPS: n(10) } }), blk('cs_bounce')] }))], { x: 200 })));
    rt.greenFlag();
    for (let i = 0; i < 5; i++) rt.step(33);
    // The ball (48 wide) cannot go past 240 - 24 = 216, and now faces left.
    expect(at(rt, 'a').x).toBeLessThanOrEqual(216);
    expect(at(rt, 'a').direction).toBe(-90);
  });

  it('touching another sprite, keys and broadcasts start scripts', () => {
    const hit = blk('cs_touching', { fields: { TARGET: 'wall' } });
    const rt = new CreativeRuntime(
      stage(
        sprite('a', [
          script(blk('cs_when_key', { fields: { KEY: 'right arrow' } }), blk('cs_change_x', { inputs: { DX: n(20) } })),
          script(flag(), blk('cs_wait_until', { inputs: { COND: hit } }), blk('cs_broadcast', { fields: { MESSAGE: 'Bump' } })),
        ]),
        sprite('wall', [script(blk('cs_when_receive', { fields: { MESSAGE: 'bump' } }), blk('cs_hide'))], { x: 60 }),
      ),
    );
    rt.greenFlag();
    rt.step(33);
    rt.keyDown('right arrow');
    rt.step(33);
    expect(at(rt, 'a').x).toBe(20);
    expect(at(rt, 'wall').visible).toBe(true); // 20 + 24 < 60 - 24: not touching yet
    rt.keyDown('right arrow');
    rt.step(33);
    rt.step(33);
    expect(at(rt, 'a').x).toBe(40);
    rt.step(33);
    expect(at(rt, 'wall').visible).toBe(false); // messages match ignoring case
  });

  it('clicking a sprite starts its "when this sprite is clicked" scripts; the topmost sprite gets the click', () => {
    const rt = new CreativeRuntime(
      stage(
        sprite('under', [script(blk('cs_when_clicked'), blk('cs_say', { inputs: { TEXT: t('under') } }))]),
        sprite('over', [script(blk('cs_when_clicked'), blk('cs_say', { inputs: { TEXT: t('over') } }))]),
      ),
    );
    rt.greenFlag();
    expect(rt.spriteAt(5, 5)).toBe('over');
    expect(rt.spriteAt(100, 100)).toBeUndefined();
    rt.click('over');
    rt.step(16);
    expect(at(rt, 'over').say?.text).toBe('over');
    expect(at(rt, 'under').say).toBeUndefined();
  });

  it('variables, maths, text and if/else work per sprite', () => {
    const v = (id: string) => blk('variables_get', { fields: { VAR: { id } } });
    const rt = new CreativeRuntime(
      stage(
        sprite('a', [
          script(
            flag(),
            blk('variables_set', { fields: { VAR: { id: 'score' } }, inputs: { VALUE: n(3) } }),
            blk('cs_repeat', { inputs: { TIMES: n(4) }, do: [blk('math_change', { fields: { VAR: { id: 'score' } }, inputs: { DELTA: n(2) } })] }),
            blk('controls_if', {
              extraState: { hasElse: true },
              inputs: { IF0: blk('logic_compare', { fields: { OP: 'GT' }, inputs: { A: v('score'), B: n(10) } }) },
            }),
          ),
        ]),
      ),
    );
    // Fill the if/else branches (DO0 and ELSE).
    const ifBlock = (rt as unknown as { sprites: Array<{ scripts: B[] }> }).sprites[0]!.scripts[0]!;
    let b = ifBlock;
    while ((b['next'] as { block?: B } | undefined)?.block) b = (b['next'] as { block: B }).block;
    (b['inputs'] as Record<string, unknown>)['DO0'] = { block: blk('cs_say', { inputs: { TEXT: blk('text_join', { extraState: { itemCount: 2 }, inputs: { ADD0: t('Score '), ADD1: v('score') } }) } }) };
    (b['inputs'] as Record<string, unknown>)['ELSE'] = { block: blk('cs_say', { inputs: { TEXT: t('low') } }) };
    rt.greenFlag();
    run(rt, 500);
    expect(at(rt, 'a').say?.text).toBe('Score 11');
  });

  it('stop all ends every script; an unknown block is reported once, not thrown', () => {
    const rt = new CreativeRuntime(
      stage(
        sprite('a', [script(flag(), blk('cs_wait', { inputs: { SECS: n(0.1) } }), blk('cs_stop', { fields: { WHAT: 'ALL' } }))]),
        sprite('b', [script(flag(), blk('cs_forever', { do: [blk('io_digital_write')] }))]),
      ),
    );
    rt.greenFlag();
    run(rt, 500);
    expect(rt.running).toBe(false);
    expect(rt.problems).toHaveLength(1);
    expect(rt.problems[0]!.message).toContain('io_digital_write');
    expect(rt.problems[0]!.message).toContain('cannot run on the stage');
  });

  it('"next costume in" animates one movement of Tariro and wraps round', () => {
    const poses = TARIRO_POSES;
    const step = blk('cs_next_in_group', { fields: { GROUP: 'walk' } });
    const rt = new CreativeRuntime(stage(sprite('t', [script(flag(), blk('cs_repeat', { inputs: { TIMES: n(6) }, do: [step] }))], { costumes: poses, costume: poses.indexOf('tariro-idle-1') })));
    rt.greenFlag();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      rt.step(33);
      seen.push(at(rt, 't').costume);
    }
    // From a pose outside the group it starts at the first walk pose; after walk 5 comes walk 1.
    expect(seen).toEqual(['tariro-walk-1', 'tariro-walk-2', 'tariro-walk-3', 'tariro-walk-4', 'tariro-walk-5', 'tariro-walk-1']);
    expect(costumeGroups(poses)).toEqual(['walk', 'run', 'jump', 'idle', 'talk', 'think', 'point', 'teach', 'laptop', 'celebrate', 'sad', 'crouch', 'fall', 'getup', 'wave']);
  });

  it('"when AI sees" starts when the AI\'s answer changes to that class, once per change', () => {
    let label = '';
    const rt = new CreativeRuntime(
      stage(sprite('a', [script(blk('ai_when', { fields: { CLASS: 'Cup' } }), blk('cs_change_x', { inputs: { DX: n(10) } }))])),
      { aiLabel: () => label },
    );
    rt.greenFlag();
    rt.step(33);
    expect(at(rt, 'a').x).toBe(0);
    label = 'Cup';
    rt.step(33);
    rt.step(33);
    rt.step(33);
    expect(at(rt, 'a').x).toBe(10); // still "Cup": no new start
    label = 'Pen';
    rt.step(33);
    label = 'Cup';
    rt.step(33);
    rt.step(33);
    expect(at(rt, 'a').x).toBe(20);
  });

  it('wraps directions into (-180, 180]', () => {
    expect([wrapDirection(270), wrapDirection(-180), wrapDirection(540), wrapDirection(-90)]).toEqual([-90, 180, 180, -90]);
  });
});

describe('Creative Studio art and stage', () => {
  it('every costume and backdrop is an SVG with the size it declares, and ids are unique', () => {
    for (const c of COSTUMES)
      if (c.svg) expect(c.svg).toMatch(new RegExp(`^<svg [^>]*width="${c.width}" height="${c.height}"`));
      else expect(c.image, c.id).toBe(`${c.id}.webp`);
    for (const b of BACKDROPS) expect(b.svg).toMatch(/^<svg [^>]*width="480" height="360"/);
    expect(new Set(COSTUMES.map((c) => c.id)).size).toBe(COSTUMES.length);
    expect(new Set(BACKDROPS.map((c) => c.id)).size).toBe(BACKDROPS.length);
  });

  it('the starter stage is valid, uses library art, and Tari says hello', () => {
    const s = defaultStage();
    expect(StageSchema.parse(s)).toEqual(s);
    for (const sp of s.sprites) for (const c of sp.costumes) expect(COSTUMES.some((x) => x.id === c)).toBe(true);
    const rt = new CreativeRuntime(s);
    rt.greenFlag();
    rt.step(16);
    expect(rt.view().sprites[0]!.say?.text).toBe('Hello! I am Tariro.');
    expect(rt.view().sprites[0]!.costume).toBe('tariro-wave-2');
  });
});
