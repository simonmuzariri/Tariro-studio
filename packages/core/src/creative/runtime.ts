/**
 * Creative Studio runtime: runs every sprite's scripts together, frame by frame. Each script is a
 * generator that yields at the end of every loop round and while it waits or glides (like the
 * screen refresh in other block-based studios), so many scripts share one thread and a program
 * can always be stopped. Time is passed in by `step(ms)`, which makes runs exact in tests.
 */
import { costumeById, SOUNDS } from './art.js';
import { STAGE_HEIGHT, STAGE_WIDTH, type Stage } from './model.js';

type Value = number | string | boolean;

interface BlockJson {
  type: string;
  id?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block?: BlockJson };
  extraState?: unknown;
  enabled?: boolean;
  disabled?: boolean;
}

export interface SpriteView {
  id: string;
  name: string;
  x: number;
  y: number;
  direction: number;
  size: number;
  visible: boolean;
  costume: string;
  costumeIndex: number;
  say?: { text: string; think: boolean };
}

export interface StageView {
  backdrop: string;
  sprites: SpriteView[];
  timer: number;
}

/** What a board block sees when it runs on the stage (Stage mode). */
export interface StageBlockContext {
  field(name: string): string;
  number(input: string, fallback?: number): number;
}

/**
 * A board block in Stage mode (LEDs, buttons, motors…). It must not wait: outputs are queued to
 * the board and inputs return the latest reading, which the app keeps up to date.
 */
export type StageBoardHandler = { kind: 'statement'; run(ctx: StageBlockContext): void } | { kind: 'value'; run(ctx: StageBlockContext): number | boolean | string };

export interface CreativeHooks {
  /** Board blocks the stage can run, by block type. */
  board?: Record<string, StageBoardHandler>;
  /** What the AI sees now (its most likely class, '' when nothing). "when AI sees" hats start when it changes. */
  aiLabel?(): string;
  /** Play a built-in sound (see SOUNDS). */
  sound?(id: string): void;
  /** Play a note: MIDI number, length in seconds. */
  note?(midi: number, seconds: number): void;
}

/** A problem in a script, reported once with the block that caused it. */
export interface CreativeProblem {
  spriteId: string;
  blockId?: string;
  message: string;
}

interface SpriteRt extends SpriteView {
  costumes: string[];
  scripts: BlockJson[];
  vars: Map<string, Value>;
}

interface Thread {
  sprite: SpriteRt;
  top: BlockJson;
  gen: Generator<void, void, void>;
  done: boolean;
}

const HAT = new Set(['cs_when_flag', 'cs_when_key', 'cs_when_clicked', 'cs_when_receive', 'ai_when']);
const HALF_W = STAGE_WIDTH / 2;
const HALF_H = STAGE_HEIGHT / 2;

/** Normalise a direction into (-180, 180], as shown to learners. */
export const wrapDirection = (d: number): number => {
  let r = ((d + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
};

const num = (v: Value): number => {
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: Value): string => (typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v));
const truthy = (v: Value): boolean => (typeof v === 'string' ? v !== '' && v !== '0' && v.toLowerCase() !== 'false' : Boolean(v));
const isOn = (b: BlockJson) => b.enabled !== false && b.disabled !== true;

const field = (b: BlockJson, name: string): string => {
  const f = b.fields?.[name];
  if (f && typeof f === 'object' && 'id' in (f as object)) return String((f as { id: unknown }).id);
  return String(f ?? '');
};
const input = (b: BlockJson, name: string): BlockJson | undefined => {
  const i = b.inputs?.[name];
  const blk = i?.block ?? i?.shadow;
  return blk && isOn(blk) ? blk : undefined;
};

class StopAll {}
class StopThis {}

export class CreativeRuntime {
  private sprites: SpriteRt[] = [];
  private threads: Thread[] = [];
  private backdrops: string[];
  private backdrop: number;
  private now = 0;
  private timerStart = 0;
  private readonly keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false };
  private readonly reported = new Set<string>();
  private lastAiLabel = '';
  readonly problems: CreativeProblem[] = [];
  /** True from the green flag until Stop (events such as key presses only start scripts then). */
  running = false;

  constructor(
    stage: Stage,
    private readonly hooks: CreativeHooks = {},
  ) {
    this.backdrops = stage.backdrops;
    this.backdrop = Math.min(stage.backdrop, stage.backdrops.length - 1);
    this.sprites = stage.sprites.map((s) => {
      const ws = (s.workspace ?? {}) as { blocks?: { blocks?: BlockJson[] } };
      const costume = Math.min(s.costume, s.costumes.length - 1);
      return {
        id: s.id,
        name: s.name,
        x: s.x,
        y: s.y,
        direction: wrapDirection(s.direction),
        size: s.size,
        visible: s.visible,
        costumes: s.costumes,
        costumeIndex: costume,
        costume: s.costumes[costume]!,
        scripts: (ws.blocks?.blocks ?? []).filter((b) => HAT.has(b.type) && isOn(b)),
        vars: new Map(),
      };
    });
  }

  // ───────────── events from the app ─────────────

  greenFlag(): void {
    this.running = true;
    this.threads = [];
    this.timerStart = this.now;
    this.startHats((b) => b.type === 'cs_when_flag');
  }

  stop(): void {
    this.running = false;
    this.threads = [];
    for (const s of this.sprites) delete s.say;
  }

  keyDown(key: string): void {
    this.keys.add(key);
    if (this.running) this.startHats((b) => b.type === 'cs_when_key' && (field(b, 'KEY') === key || field(b, 'KEY') === 'any'), undefined, false);
  }

  keyUp(key: string): void {
    this.keys.delete(key);
  }

  mouseMove(x: number, y: number, down?: boolean): void {
    this.mouse.x = x;
    this.mouse.y = y;
    if (down !== undefined) this.mouse.down = down;
  }

  /** The learner clicked a sprite on the stage. */
  click(spriteId: string): void {
    if (!this.running) return;
    const s = this.sprites.find((sp) => sp.id === spriteId);
    if (s) this.startHats((b) => b.type === 'cs_when_clicked', [s]);
  }

  /** The topmost visible sprite at a stage point (for clicks). */
  spriteAt(x: number, y: number): string | undefined {
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i]!;
      if (!s.visible) continue;
      const b = this.bounds(s);
      if (x >= b.left && x <= b.right && y >= b.bottom && y <= b.top) return s.id;
    }
    return undefined;
  }

  /** Advance time by `ms` and give every script one turn. */
  step(ms: number): void {
    this.now += ms;
    if (!this.running) return;
    const seen = this.hooks.aiLabel?.() ?? '';
    if (seen !== this.lastAiLabel) {
      this.lastAiLabel = seen;
      if (seen) this.startHats((b) => b.type === 'ai_when' && field(b, 'CLASS') === seen, undefined, false);
    }
    for (const t of [...this.threads]) {
      if (t.done || !this.running) continue;
      try {
        if (t.gen.next().done) t.done = true;
      } catch (e) {
        t.done = true;
        if (e instanceof StopAll) {
          this.stop();
          return;
        }
        if (!(e instanceof StopThis)) this.report(t.sprite, undefined, e instanceof Error ? e.message : String(e));
      }
    }
    this.threads = this.threads.filter((t) => !t.done);
  }

  /** Whether any script is still running (a program that only waits for events has none). */
  get busy(): boolean {
    return this.threads.length > 0;
  }

  view(): StageView {
    return {
      backdrop: this.backdrops[this.backdrop]!,
      timer: (this.now - this.timerStart) / 1000,
      sprites: this.sprites.map(({ id, name, x, y, direction, size, visible, costume, costumeIndex, say }) => ({
        id,
        name,
        x,
        y,
        direction,
        size,
        visible,
        costume,
        costumeIndex,
        ...(say ? { say: { ...say } } : {}),
      })),
    };
  }

  // ───────────── scripts ─────────────

  /**
   * Start every matching script. One that is already running starts again from the top, except
   * with `restart: false` (key presses), where a press while it runs is ignored.
   */
  private startHats(match: (hat: BlockJson) => boolean, only?: SpriteRt[], restart = true): Thread[] {
    const started: Thread[] = [];
    for (const s of only ?? this.sprites)
      for (const top of s.scripts) {
        if (!match(top)) continue;
        const runningNow = this.threads.some((t) => t.top === top && t.sprite === s && !t.done);
        if (runningNow && !restart) continue;
        this.threads = this.threads.filter((t) => t.top !== top || t.sprite !== s);
        const t: Thread = { sprite: s, top, gen: this.chain(s, top.next?.block), done: false };
        this.threads.push(t);
        started.push(t);
      }
    return started;
  }

  private *chain(s: SpriteRt, first: BlockJson | undefined): Generator<void, void, void> {
    for (let b = first; b; b = b.next?.block) if (isOn(b)) yield* this.exec(s, b);
  }

  /** A loop body, then one frame. */
  private *round(s: SpriteRt, b: BlockJson): Generator<void, void, void> {
    yield* this.chain(s, b.inputs?.['DO']?.block);
    yield;
  }

  private *waitMs(ms: number): Generator<void, void, void> {
    const end = this.now + Math.max(0, ms);
    do yield;
    while (this.now < end);
  }

  private *exec(s: SpriteRt, b: BlockJson): Generator<void, void, void> {
    const n = (name: string) => num(this.value(s, input(b, name)));
    const t = (name: string) => str(this.value(s, input(b, name)));
    switch (b.type) {
      // ── motion
      case 'cs_move': {
        const steps = n('STEPS');
        const rad = (s.direction * Math.PI) / 180;
        s.x += steps * Math.sin(rad);
        s.y += steps * Math.cos(rad);
        return;
      }
      case 'cs_turn_right':
        s.direction = wrapDirection(s.direction + n('DEG'));
        return;
      case 'cs_turn_left':
        s.direction = wrapDirection(s.direction - n('DEG'));
        return;
      case 'cs_goto_xy':
        s.x = n('X');
        s.y = n('Y');
        return;
      case 'cs_goto': {
        const p = this.point(s, field(b, 'TARGET'));
        if (p) [s.x, s.y] = p;
        return;
      }
      case 'cs_glide_xy': {
        const [x0, y0, x1, y1, ms] = [s.x, s.y, n('X'), n('Y'), n('SECS') * 1000];
        const start = this.now;
        while (this.now - start < ms) {
          const f = (this.now - start) / ms;
          s.x = x0 + (x1 - x0) * f;
          s.y = y0 + (y1 - y0) * f;
          yield;
        }
        s.x = x1;
        s.y = y1;
        return;
      }
      case 'cs_point':
        s.direction = wrapDirection(n('DIR'));
        return;
      case 'cs_point_towards': {
        const p = this.point(s, field(b, 'TARGET'));
        if (p && (p[0] !== s.x || p[1] !== s.y)) s.direction = wrapDirection((Math.atan2(p[0] - s.x, p[1] - s.y) * 180) / Math.PI);
        return;
      }
      case 'cs_change_x':
        s.x += n('DX');
        return;
      case 'cs_set_x':
        s.x = n('X');
        return;
      case 'cs_change_y':
        s.y += n('DY');
        return;
      case 'cs_set_y':
        s.y = n('Y');
        return;
      case 'cs_bounce':
        this.bounce(s);
        return;

      // ── looks
      case 'cs_say':
      case 'cs_think': {
        const text = t('TEXT');
        if (text === '') delete s.say;
        else s.say = { text, think: b.type === 'cs_think' };
        return;
      }
      case 'cs_say_for': {
        const bubble = { text: t('TEXT'), think: false };
        s.say = bubble;
        yield* this.waitMs(n('SECS') * 1000);
        if (s.say === bubble) delete s.say;
        return;
      }
      case 'cs_costume': {
        const i = s.costumes.indexOf(field(b, 'COSTUME'));
        if (i >= 0) this.setCostume(s, i);
        return;
      }
      case 'cs_next_costume':
        this.setCostume(s, (s.costumeIndex + 1) % s.costumes.length);
        return;
      case 'cs_next_in_group': {
        // The next pose of one movement (walk 1 → 2 → … → 1), from wherever the sprite is now.
        const group = field(b, 'GROUP');
        const members = s.costumes.map((id, i) => [id, i] as const).filter(([id]) => costumeById(id)?.group === group);
        if (members.length === 0) return;
        const at = members.findIndex(([, i]) => i === s.costumeIndex);
        this.setCostume(s, members[(at + 1) % members.length]![1]);
        return;
      }
      case 'cs_backdrop': {
        const i = this.backdrops.indexOf(field(b, 'BACKDROP'));
        if (i >= 0) this.backdrop = i;
        return;
      }
      case 'cs_next_backdrop':
        this.backdrop = (this.backdrop + 1) % this.backdrops.length;
        return;
      case 'cs_change_size':
        s.size = Math.min(Math.max(s.size + n('D'), 5), 500);
        return;
      case 'cs_set_size':
        s.size = Math.min(Math.max(n('SIZE'), 5), 500);
        return;
      case 'cs_show':
        s.visible = true;
        return;
      case 'cs_hide':
        s.visible = false;
        return;
      case 'cs_front':
        this.sprites = [...this.sprites.filter((x) => x !== s), s];
        return;

      // ── sound
      case 'cs_play':
        this.hooks.sound?.(field(b, 'SOUND'));
        return;
      case 'cs_play_wait': {
        const id = field(b, 'SOUND');
        this.hooks.sound?.(id);
        yield* this.waitMs((SOUNDS.find((x) => x.id === id)?.seconds ?? 0) * 1000);
        return;
      }
      case 'cs_note': {
        const secs = Math.min(Math.max(n('SECS'), 0), 10);
        this.hooks.note?.(Math.min(Math.max(Math.round(n('NOTE')), 0), 127), secs);
        yield* this.waitMs(secs * 1000);
        return;
      }

      // ── events
      case 'cs_broadcast':
        this.startHats((h) => h.type === 'cs_when_receive' && field(h, 'MESSAGE').trim().toLowerCase() === field(b, 'MESSAGE').trim().toLowerCase());
        return;
      case 'cs_broadcast_wait': {
        const started = this.startHats((h) => h.type === 'cs_when_receive' && field(h, 'MESSAGE').trim().toLowerCase() === field(b, 'MESSAGE').trim().toLowerCase());
        do yield;
        while (started.some((x) => !x.done && this.threads.includes(x)));
        return;
      }

      // ── control
      case 'cs_wait':
        yield* this.waitMs(n('SECS') * 1000);
        return;
      case 'cs_forever':
        for (;;) yield* this.round(s, b);
      case 'cs_repeat': {
        const times = Math.round(n('TIMES'));
        for (let i = 0; i < times; i++) yield* this.round(s, b);
        return;
      }
      case 'cs_repeat_until':
        while (!truthy(this.value(s, input(b, 'COND')))) yield* this.round(s, b);
        return;
      case 'cs_wait_until':
        while (!truthy(this.value(s, input(b, 'COND')))) yield;
        return;
      case 'cs_stop':
        if (field(b, 'WHAT') === 'THIS') throw new StopThis();
        throw new StopAll();
      case 'controls_if': {
        const st = (b.extraState ?? {}) as { elseIfCount?: number; hasElse?: boolean };
        for (let i = 0; i <= (st.elseIfCount ?? 0); i++)
          if (truthy(this.value(s, input(b, `IF${i}`)))) return yield* this.chain(s, b.inputs?.[`DO${i}`]?.block);
        if (st.hasElse) yield* this.chain(s, b.inputs?.['ELSE']?.block);
        return;
      }

      // ── sensing
      case 'cs_reset_timer':
        this.timerStart = this.now;
        return;

      // ── variables
      case 'variables_set':
        s.vars.set(field(b, 'VAR'), this.value(s, input(b, 'VALUE')));
        return;
      case 'math_change':
        s.vars.set(field(b, 'VAR'), num(s.vars.get(field(b, 'VAR')) ?? 0) + n('DELTA'));
        return;

      default: {
        const h = this.hooks.board?.[b.type];
        if (h?.kind === 'statement') return void h.run(this.boardContext(s, b));
        this.report(s, b.id, `The block "${b.type}" cannot run on the stage.`);
      }
    }
  }

  private boardContext(s: SpriteRt, b: BlockJson): StageBlockContext {
    return {
      field: (name) => field(b, name),
      number: (name, fallback = 0) => {
        const blk = input(b, name);
        return blk ? num(this.value(s, blk)) : fallback;
      },
    };
  }

  private value(s: SpriteRt, b: BlockJson | undefined): Value {
    if (!b) return '';
    const n = (name: string) => num(this.value(s, input(b, name)));
    switch (b.type) {
      case 'math_number':
        return num(field(b, 'NUM'));
      case 'text':
        return field(b, 'TEXT');
      case 'logic_boolean':
        return field(b, 'BOOL') === 'TRUE';
      case 'math_arithmetic': {
        const [a, c] = [n('A'), n('B')];
        switch (field(b, 'OP')) {
          case 'MINUS':
            return a - c;
          case 'MULTIPLY':
            return a * c;
          case 'DIVIDE':
            return c === 0 ? (a === 0 ? 0 : a > 0 ? Infinity : -Infinity) : a / c;
          case 'POWER':
            return a ** c;
          default:
            return a + c;
        }
      }
      case 'math_random_int': {
        const [lo, hi] = [Math.round(n('FROM')), Math.round(n('TO'))].sort((x, y) => x - y) as [number, number];
        return lo + Math.floor(Math.random() * (hi - lo + 1));
      }
      case 'math_modulo': {
        const d = n('DIVISOR');
        return d === 0 ? 0 : ((n('DIVIDEND') % d) + d) % d;
      }
      case 'math_round': {
        const x = n('NUM');
        const op = field(b, 'OP');
        return op === 'ROUNDUP' ? Math.ceil(x) : op === 'ROUNDDOWN' ? Math.floor(x) : Math.round(x);
      }
      case 'logic_compare': {
        const a = this.value(s, input(b, 'A'));
        const c = this.value(s, input(b, 'B'));
        // Numbers compare as numbers; otherwise as text, ignoring case.
        const both = !isNaN(Number(a)) && !isNaN(Number(c)) && a !== '' && c !== '';
        const [x, y] = both ? [num(a), num(c)] : [str(a).toLowerCase(), str(c).toLowerCase()];
        switch (field(b, 'OP')) {
          case 'NEQ':
            return x !== y;
          case 'LT':
            return x < y;
          case 'LTE':
            return x <= y;
          case 'GT':
            return x > y;
          case 'GTE':
            return x >= y;
          default:
            return x === y;
        }
      }
      case 'logic_operation': {
        const and = field(b, 'OP') === 'AND';
        const a = truthy(this.value(s, input(b, 'A')));
        if (and ? !a : a) return a;
        return truthy(this.value(s, input(b, 'B')));
      }
      case 'logic_negate':
        return !truthy(this.value(s, input(b, 'BOOL')));
      case 'text_join': {
        const count = (b.extraState as { itemCount?: number } | undefined)?.itemCount ?? 2;
        let out = '';
        for (let i = 0; i < count; i++) out += str(this.value(s, input(b, `ADD${i}`)));
        return out;
      }
      case 'text_length':
        return str(this.value(s, input(b, 'VALUE'))).length;
      case 'variables_get':
        return s.vars.get(field(b, 'VAR')) ?? 0;

      case 'cs_x':
        return s.x;
      case 'cs_y':
        return s.y;
      case 'cs_direction':
        return s.direction;
      case 'cs_size':
        return s.size;
      case 'cs_costume_number':
        return s.costumeIndex + 1;
      case 'cs_touching':
        return this.touching(s, field(b, 'TARGET'));
      case 'cs_key_pressed': {
        const k = field(b, 'KEY');
        return k === 'any' ? this.keys.size > 0 : this.keys.has(k);
      }
      case 'cs_mouse_down':
        return this.mouse.down;
      case 'cs_mouse_x':
        return this.mouse.x;
      case 'cs_mouse_y':
        return this.mouse.y;
      case 'cs_distance_to': {
        const p = this.point(s, field(b, 'TARGET'));
        return p ? Math.hypot(p[0] - s.x, p[1] - s.y) : 0;
      }
      case 'cs_timer':
        return Math.round((this.now - this.timerStart) / 100) / 10;
      default: {
        const h = this.hooks.board?.[b.type];
        if (h?.kind === 'value') return h.run(this.boardContext(s, b));
        this.report(s, b.id, `The block "${b.type}" cannot run on the stage.`);
        return '';
      }
    }
  }

  // ───────────── geometry ─────────────

  /** Bounding box of a sprite's costume (not rotated: a turned sprite keeps its upright box). */
  private bounds(s: SpriteRt) {
    const c = costumeById(s.costume);
    const k = s.size / 100;
    const hw = ((c?.width ?? 40) * k) / 2;
    const hh = ((c?.height ?? 40) * k) / 2;
    return { left: s.x - hw, right: s.x + hw, bottom: s.y - hh, top: s.y + hh, hw, hh };
  }

  private bounce(s: SpriteRt): void {
    const b = this.bounds(s);
    if (b.left < -HALF_W || b.right > HALF_W) {
      s.x = b.left < -HALF_W ? -HALF_W + b.hw : HALF_W - b.hw;
      s.direction = wrapDirection(-s.direction);
    }
    if (b.bottom < -HALF_H || b.top > HALF_H) {
      s.y = b.bottom < -HALF_H ? -HALF_H + b.hh : HALF_H - b.hh;
      s.direction = wrapDirection(180 - s.direction);
    }
  }

  private touching(s: SpriteRt, target: string): boolean {
    if (!s.visible) return false;
    const a = this.bounds(s);
    if (target === '_edge') return a.left <= -HALF_W || a.right >= HALF_W || a.bottom <= -HALF_H || a.top >= HALF_H;
    if (target === '_mouse') return this.mouse.x >= a.left && this.mouse.x <= a.right && this.mouse.y >= a.bottom && this.mouse.y <= a.top;
    const o = this.sprites.find((x) => x.id === target);
    if (!o || o === s || !o.visible) return false;
    const c = this.bounds(o);
    return a.left < c.right && a.right > c.left && a.bottom < c.top && a.top > c.bottom;
  }

  private point(s: SpriteRt, target: string): [number, number] | undefined {
    if (target === '_mouse') return [this.mouse.x, this.mouse.y];
    if (target === '_random') return [Math.round(Math.random() * STAGE_WIDTH - HALF_W), Math.round(Math.random() * STAGE_HEIGHT - HALF_H)];
    const o = this.sprites.find((x) => x.id === target);
    return o && o !== s ? [o.x, o.y] : undefined;
  }

  private setCostume(s: SpriteRt, i: number): void {
    s.costumeIndex = i;
    s.costume = s.costumes[i]!;
  }

  private report(s: SpriteRt, blockId: string | undefined, message: string): void {
    const key = `${s.id}:${blockId}:${message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.problems.push({ spriteId: s.id, ...(blockId ? { blockId } : {}), message });
  }
}
