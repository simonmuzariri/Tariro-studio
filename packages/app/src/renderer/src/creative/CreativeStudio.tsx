import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import { Brain, Flag, ImagePlus, Octagon, Plus, Trash2, X } from '../ui/icons';
import {
  BACKDROPS,
  CHARACTERS,
  COSTUMES,
  CreativeRuntime,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  backdropById,
  costumeById,
  type BoardDefinition,
  type CreativeProblem,
  type ExperienceLevel,
  type ImageModel,
  type Stage,
  type StageView,
} from '@tariro-studio/core';
import { buildToolbox, stageBoardHandlers, stageBoardToolbox } from '@tariro-studio/extensions';
import { blocklyTheme } from '../blockly/theme';
import { registry } from '../registry';
import { AddExtensionButton } from '../ui/AddExtensionButton';
import type { ThemeName } from '../ui/theme';
import { CREATIVE_TOOLBOX, creativeContext, registerCreativeBlocks } from './blocks';
import { artSrc, drawStage, loadAllArt } from './draw';
import { playNote, playSound } from './sound';
import { StageLink } from './stageLink';
import { AiSession, aiNeeds, aiStageHandlers, usesAi } from './aiSession';
import { camera } from '../ai/camera';

interface Props {
  stage: Stage;
  onChange(stage: Stage): void;
  theme: ThemeName;
  /** The board whose blocks sprites can use (driven over the live-mode link). */
  board: BoardDefinition;
  extensions: string[];
  level: ExperienceLevel;
  port: string;
  /** Why the green flag cannot start now (live mode or Python is using the board). */
  blocked?: string | undefined;
  onAddExtension?: () => void;
  /** The AI image classifier (trained in the AI panel). */
  ai?: ImageModel | undefined;
  onOpenAi?: () => void;
  /** Gesture and sound models (4f), and the panels that teach them. */
  gesture?: ImageModel | undefined;
  sound?: ImageModel | undefined;
  onOpenTrainer?: (kind: 'gesture' | 'sound' | 'playground') => void;
}

/** Sprite categories first, then the board's (only blocks the stage can run). */
function stageToolbox(board: BoardDefinition, extensions: string[], level: ExperienceLevel): Blockly.utils.toolbox.ToolboxDefinition {
  const boardPart = buildToolbox(stageBoardToolbox(registry, board, extensions, level)) as unknown as { contents: unknown[] };
  const own = CREATIVE_TOOLBOX as unknown as { kind: string; contents: unknown[] };
  return { ...own, contents: [...own.contents, ...boardPart.contents] } as unknown as Blockly.utils.toolbox.ToolboxDefinition;
}

/** The stage as the editor holds it (before a run, or after an edit). */
const editorView = (stage: Stage, drag?: { id: string; x: number; y: number } | null): StageView => ({
  backdrop: stage.backdrops[Math.min(stage.backdrop, stage.backdrops.length - 1)]!,
  timer: 0,
  sprites: stage.sprites.map((s) => {
    const i = Math.min(s.costume, s.costumes.length - 1);
    const moved = drag && drag.id === s.id ? { x: drag.x, y: drag.y } : {};
    return { id: s.id, name: s.name, x: s.x, y: s.y, direction: s.direction, size: s.size, visible: s.visible, costume: s.costumes[i]!, costumeIndex: i, ...moved };
  }),
});

const KEY_NAMES: Record<string, string> = { ' ': 'space', ArrowUp: 'up arrow', ArrowDown: 'down arrow', ArrowLeft: 'left arrow', ArrowRight: 'right arrow' };
const keyName = (e: KeyboardEvent): string | undefined => KEY_NAMES[e.key] ?? (/^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : undefined);
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.blocklyWidgetDiv, .blocklyDropDownDiv'));

const newId = (stage: Stage, base: string) => {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'sprite';
  let id = slug;
  for (let i = 2; stage.sprites.some((s) => s.id === id); i++) id = `${slug}-${i}`;
  return id;
};
const newName = (stage: Stage, base: string) => {
  let name = base;
  for (let i = 2; stage.sprites.some((s) => s.name === name); i++) name = `${base} ${i}`;
  return name;
};

/** Somewhere near the middle of the stage for a new sprite. */
function randomSpot() {
  return { x: Math.round(Math.random() * 240 - 120), y: Math.round(Math.random() * 160 - 80) };
}

/** Creative Studio: sprites, costumes, backdrops and sounds, programmed with event blocks. */
export default function CreativeStudio({ stage, onChange, theme, board, extensions, level, port, blocked, onAddExtension, ai, onOpenAi, gesture, sound, onOpenTrainer }: Props) {
  const [selected, setSelected] = useState<string | null>(stage.sprites[0]?.id ?? null);
  const sprite = stage.sprites.find((s) => s.id === selected) ?? stage.sprites[0];
  const [running, setRunning] = useState(false);
  const [problems, setProblems] = useState<CreativeProblem[]>([]);
  const [library, setLibrary] = useState(false);
  const [ready, setReady] = useState(false);
  /** The board link's latest message (connected, or why the board cannot be used). */
  const [boardNote, setBoardNote] = useState<{ message: string; ok: boolean } | null>(null);
  const link = useRef<StageLink | null>(null);
  const aiSession = useRef<AiSession | null>(null);
  const settings = useRef({ board, extensions, level, port, blocked, ai, onOpenAi, gesture, sound, onOpenTrainer });
  useLayoutEffect(() => {
    settings.current = { board, extensions, level, port, blocked, ai, onOpenAi, gesture, sound, onOpenTrainer };
    creativeContext.aiClasses = ai?.trained?.classes ?? [];
    creativeContext.gestureClasses = gesture?.trained?.classes ?? [];
    creativeContext.soundClasses = sound?.trained?.classes ?? [];
  });
  const libraryRef = useRef<HTMLDivElement>(null);

  const canvas = useRef<HTMLCanvasElement>(null);
  const blocksHost = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const wsSprite = useRef<string | null>(null);
  const runtime = useRef<CreativeRuntime | null>(null);
  const raf = useRef(0);
  const drag = useRef<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null);
  const latest = useRef({ stage, onChange, spriteId: sprite?.id ?? null });
  useLayoutEffect(() => {
    latest.current = { stage, onChange, spriteId: sprite?.id ?? null };
    creativeContext.stage = stage;
    creativeContext.spriteId = sprite?.id ?? null;
  });

  const scale = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);
  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const rt = runtime.current;
    const d = drag.current;
    const session = aiSession.current;
    const video = rt?.running && session && session.video !== 'off' ? { el: camera.video, flipped: session.video === 'flipped' } : null;
    drawStage(c, rt ? rt.view() : editorView(latest.current.stage, d), { scale, selected: rt?.running ? null : latest.current.spriteId, video });
  }, [scale]);

  useEffect(() => {
    void loadAllArt().then(() => setReady(true));
  }, []);

  // The library opens below the sprites; bring it into view on short windows.
  useEffect(() => {
    if (library) libraryRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [library]);

  // An edit after a run shows the stage as set up again (the run's last frame stays until then).
  useEffect(() => {
    if (runtime.current && !runtime.current.running) runtime.current = null;
    redraw();
  }, [stage, selected, ready, redraw]);

  // ── blocks: one workspace, loaded with the selected sprite's scripts
  const updateSprite = useCallback((id: string, change: Partial<Stage['sprites'][number]>) => {
    const { stage: st, onChange: emit } = latest.current;
    emit({ ...st, sprites: st.sprites.map((s) => (s.id === id ? { ...s, ...change } : s)) });
  }, []);

  useEffect(() => {
    if (!blocksHost.current) return;
    registerCreativeBlocks();
    const w = Blockly.inject(blocksHost.current, {
      toolbox: stageToolbox(settings.current.board, settings.current.extensions, settings.current.level),
      theme: blocklyTheme(theme),
      renderer: 'zelos',
      media: './',
      trashcan: true,
      sounds: true,
      zoom: { controls: true, wheel: true, startScale: 0.7, maxScale: 2, minScale: 0.3 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: theme === 'light' ? '#d9dce2' : '#2c3039', snap: false },
    });
    ws.current = w;
    w.registerButtonCallback('tariro-ai-train', () => settings.current.onOpenAi?.());
    w.registerButtonCallback('tariro-ai-gestures', () => settings.current.onOpenTrainer?.('gesture'));
    w.registerButtonCallback('tariro-ai-sounds', () => settings.current.onOpenTrainer?.('sound'));
    w.registerButtonCallback('tariro-ai-playground', () => settings.current.onOpenTrainer?.('playground'));
    const listener = (e: Blockly.Events.Abstract) => {
      if (e.isUiEvent || !wsSprite.current) return;
      updateSprite(wsSprite.current, { workspace: Blockly.serialization.workspaces.save(w) as Record<string, unknown> });
    };
    w.addChangeListener(listener);
    const resize = new ResizeObserver(() => Blockly.svgResize(w));
    resize.observe(blocksHost.current);
    return () => {
      resize.disconnect();
      w.dispose();
      ws.current = null;
      wsSprite.current = null;
    };
    // The theme is applied by the effect below after the first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateSprite]);

  useEffect(() => {
    ws.current?.setTheme(blocklyTheme(theme));
  }, [theme]);

  // Another board, extension set or experience level: new board categories.
  const toolboxKey = `${board.id}|${extensions.join(',')}|${level}`;
  useEffect(() => {
    const w = ws.current;
    if (!w) return;
    const { board: b, extensions: e, level: l } = settings.current;
    w.updateToolbox(stageToolbox(b, e, l));
    w.refreshToolboxSelection();
  }, [toolboxKey]);

  const spriteId = sprite?.id ?? null;
  useEffect(() => {
    const w = ws.current;
    if (!w || wsSprite.current === spriteId) return;
    const s = latest.current.stage.sprites.find((x) => x.id === spriteId);
    Blockly.Events.disable();
    try {
      w.clear();
      if (s?.workspace) Blockly.serialization.workspaces.load(s.workspace, w);
    } finally {
      Blockly.Events.enable();
    }
    wsSprite.current = spriteId;
    w.scrollCenter();
  }, [spriteId]);

  // ── running
  const releaseBoard = useCallback(() => {
    const l = link.current;
    link.current = null;
    if (l) void l.close();
    aiSession.current?.stop();
    aiSession.current = null;
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    runtime.current?.stop();
    releaseBoard();
    setRunning(false);
    redraw();
  }, [redraw, releaseBoard]);

  const go = () => {
    const { blocked: why, board: b, port: p } = settings.current;
    if (why) {
      setBoardNote({ message: why, ok: false });
      return;
    }
    cancelAnimationFrame(raf.current);
    releaseBoard();
    const l = new StageLink(p, (message, ok) => setBoardNote({ message, ok }));
    link.current = l;
    // AI Vision blocks: the camera (and, with a trained model, recognition) starts with the flag.
    const st = latest.current.stage;
    if (usesAi(st.sprites.map((sp) => sp.workspace))) {
      const trained = settings.current.ai?.trained;
      const needs = aiNeeds(st.sprites.map((sp) => sp.workspace));
      const session = new AiSession(trained, (message) => setBoardNote({ message, ok: false }), needs, { gesture: settings.current.gesture?.trained, sound: settings.current.sound?.trained });
      const untaught = (needs.gesture && !settings.current.gesture?.trained ? 'gestures' : '') || (needs.sound && /"type":"ai_sound/.test(JSON.stringify(st.sprites.map((sp) => sp.workspace))) && !settings.current.sound?.trained ? 'sounds' : '');
      if (untaught) setTimeout(() => setBoardNote({ message: `The AI has not learned any ${untaught} yet: open AI Vision → "Teach ${untaught}…" first.`, ok: false }), 0);
      aiSession.current = session;
      void session.start();
      if (!trained && JSON.stringify(st.sprites.map((sp) => sp.workspace)).match(/"type":"ai_(when|is|label|confidence)"/))
        setTimeout(() => setBoardNote({ message: 'The AI has not learned anything yet: open AI Vision → "Train an image model…" first.', ok: false }), 0);
    }
    const boardHandlers = stageBoardHandlers(l, b);
    const handlers = { ...boardHandlers, ...aiStageHandlers(() => aiSession.current, { run: boardHandlers['tariro_motor_run'], stop: boardHandlers['tariro_motor_stop'] }) };
    const rt = new CreativeRuntime(st, {
      sound: playSound,
      note: playNote,
      board: handlers,
      aiLabel: () => aiSession.current?.label ?? '',
    });
    // Fail-safe: if the AI stops answering while the program uses the board, stop the motors.
    let failsafe = false;
    const checkAi = () => {
      const s = aiSession.current;
      if (!s?.stalled || !l.inUse) {
        failsafe = false;
        return;
      }
      if (failsafe) return;
      failsafe = true;
      const stopAll = handlers['tariro_motor_stop'];
      try {
        if (stopAll?.kind === 'statement') stopAll.run({ field: () => 'BOTH', number: () => 0 });
      } catch {
        /* a board without a motor driver: nothing to stop */
      }
      setBoardNote({ message: 'Safety: the AI stopped seeing (is the camera off or stuck?), so the motors were stopped.', ok: false });
    };
    runtime.current = rt;
    setProblems([]);
    setBoardNote(null);
    setRunning(true);
    rt.greenFlag();
    let last = performance.now();
    let reported = 0;
    const frame = (now: number) => {
      rt.step(Math.min(now - last, 100));
      last = now;
      checkAi();
      redraw();
      if (rt.problems.length !== reported) {
        reported = rt.problems.length;
        setProblems([...rt.problems]);
      }
      if (!rt.running) {
        releaseBoard(); // "stop all": the board's pins go off too
        setRunning(false);
        return;
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      releaseBoard();
    },
    [releaseBoard],
  );

  // The emergency stop or the safety watchdog switched the board off: the stage stops too.
  useEffect(
    () =>
      window.studio.live.onState((s) => {
        if (!s.connected && (s.estop || s.error) && runtime.current?.running) stop();
      }),
    [stop],
  );

  // For end-to-end tests: what the stage shows (the canvas itself cannot be read as text).
  useEffect(() => {
    (window as unknown as { __tariroCreative?: { view(): StageView } }).__tariroCreative = {
      view: () => runtime.current?.view() ?? editorView(latest.current.stage),
    };
  }, []);

  // Keys go to the program while it runs (not while typing in a field or a block).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const rt = runtime.current;
      const k = keyName(e);
      if (!rt?.running || !k || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
      if (!e.repeat) rt.keyDown(k);
    };
    const up = (e: KeyboardEvent) => {
      const k = keyName(e);
      if (k) runtime.current?.keyUp(k);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ── stage pointer: clicks and the mouse while running; dragging sprites while not
  const stagePoint = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * STAGE_WIDTH - STAGE_WIDTH / 2, STAGE_HEIGHT / 2 - ((e.clientY - r.top) / r.height) * STAGE_HEIGHT] as const;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const [x, y] = stagePoint(e);
    const rt = runtime.current;
    if (rt?.running) {
      rt.mouseMove(x, y, true);
      const hit = rt.spriteAt(x, y);
      if (hit) rt.click(hit);
      return;
    }
    const hit = new CreativeRuntime(latest.current.stage).spriteAt(x, y);
    if (!hit) return;
    setSelected(hit);
    const s = latest.current.stage.sprites.find((sp) => sp.id === hit)!;
    drag.current = { id: hit, x: s.x, y: s.y, dx: x - s.x, dy: y - s.y };
    runtime.current = null;
    canvas.current!.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const [x, y] = stagePoint(e);
    runtime.current?.mouseMove(x, y);
    const d = drag.current;
    if (!d) return;
    d.x = Math.round(Math.min(Math.max(x - d.dx, -STAGE_WIDTH / 2), STAGE_WIDTH / 2));
    d.y = Math.round(Math.min(Math.max(y - d.dy, -STAGE_HEIGHT / 2), STAGE_HEIGHT / 2));
    redraw();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const [x, y] = stagePoint(e);
    runtime.current?.mouseMove(x, y, false);
    const d = drag.current;
    drag.current = null;
    if (d) updateSprite(d.id, { x: d.x, y: d.y });
  };

  // ── sprites and backdrops
  const addSprite = (character: string, costumes: string[]) => {
    const st = latest.current.stage;
    const id = newId(st, character);
    onChange({
      ...st,
      sprites: [
        ...st.sprites,
        { id, name: newName(st, character), costumes, costume: 0, ...randomSpot(), direction: 90, size: 100, visible: true },
      ],
    });
    setSelected(id);
    setLibrary(false);
  };
  const removeSprite = (id: string) => {
    const st = latest.current.stage;
    const s = st.sprites.find((x) => x.id === id);
    if (!s || !window.confirm(`Delete the sprite "${s.name}" and its scripts?`)) return;
    const rest = st.sprites.filter((x) => x.id !== id);
    onChange({ ...st, sprites: rest });
    setSelected(rest[0]?.id ?? null);
  };
  const numberField = (label: string, key: 'x' | 'y' | 'size' | 'direction', min?: number, max?: number) =>
    sprite && (
      <label className="cs-field">
        <span>{label}</span>
        <input
          type="number"
          value={Math.round(sprite[key])}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) updateSprite(sprite.id, { [key]: min !== undefined && max !== undefined ? Math.min(Math.max(v, min), max) : v });
          }}
          data-testid={`cs-${key}`}
        />
      </label>
    );

  return (
    <section className="cs" data-testid="creative-studio" aria-label="Creative Studio">
      <div className="cs-blocks-wrap">
        <div className="cs-blocks" ref={blocksHost} data-testid="cs-blocks" />
        {onAddExtension && <AddExtensionButton onClick={onAddExtension} />}
      </div>
      <aside className="cs-side">
        <div className="cs-stage-bar">
          <button type="button" className="btn cs-flag" onClick={go} data-tip="Green flag: start the program" aria-label="Start" data-testid="cs-go">
            <Flag className="icon" aria-hidden="true" />
          </button>
          <button type="button" className="btn cs-stop" onClick={stop} disabled={!running} data-tip="Stop everything" aria-label="Stop" data-testid="cs-stop">
            <Octagon className="icon" aria-hidden="true" />
          </button>
          <span className="cs-status" data-testid="cs-status">
            {running ? 'Running — click sprites or press keys' : 'Click the green flag to start'}
          </span>
          {onOpenAi && (
            <button type="button" className="btn small cs-ai" onClick={onOpenAi} data-tip="Teach the computer to recognise things with the camera" data-testid="cs-open-ai">
              <Brain className="icon sm" aria-hidden="true" />
              Teach AI
            </button>
          )}
          {onOpenTrainer && (
            <button type="button" className="btn small cs-ai" onClick={() => onOpenTrainer('playground')} data-tip="See what each AI tool finds in the camera picture" data-testid="cs-open-playground">
              Playground
            </button>
          )}
        </div>
        <canvas
          ref={canvas}
          className={`cs-stage${running ? ' running' : ''}`}
          width={STAGE_WIDTH * scale}
          height={STAGE_HEIGHT * scale}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="Stage"
          data-testid="cs-stage"
        />
        {boardNote && (
          <p className={`cs-board-note${boardNote.ok ? ' ok' : ''}`} data-testid="cs-board-note">
            {boardNote.message}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="cs-problems" data-testid="cs-problems">
            {problems.map((p, i) => (
              <li key={i}>
                {stage.sprites.find((s) => s.id === p.spriteId)?.name}: {p.message}
              </li>
            ))}
          </ul>
        )}
        {sprite && (
          <div className="cs-props" data-testid="cs-props">
            <label className="cs-field wide">
              <span>Sprite</span>
              <input value={sprite.name} maxLength={40} onChange={(e) => e.target.value.trim() && updateSprite(sprite.id, { name: e.target.value })} data-testid="cs-name" />
            </label>
            {numberField('x', 'x', -240, 240)}
            {numberField('y', 'y', -180, 180)}
            {numberField('size %', 'size', 5, 500)}
            {numberField('direction', 'direction', -180, 180)}
            <label className="cs-field check">
              <input type="checkbox" checked={sprite.visible} onChange={(e) => updateSprite(sprite.id, { visible: e.target.checked })} data-testid="cs-visible" />
              <span>show</span>
            </label>
          </div>
        )}
        <div className="cs-sprites" role="listbox" aria-label="Sprites">
          {stage.sprites.map((s) => {
            const c = costumeById(s.costumes[Math.min(s.costume, s.costumes.length - 1)]!);
            return (
              <div key={s.id} role="option" aria-selected={s.id === sprite?.id} className={`cs-sprite${s.id === sprite?.id ? ' on' : ''}`} onClick={() => setSelected(s.id)} data-testid={`cs-sprite-${s.id}`}>
                {c && <img src={artSrc(c)} alt="" draggable={false} />}
                <span>{s.name}</span>
                {s.id === sprite?.id && (
                  <button
                    type="button"
                    className="cs-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSprite(s.id);
                    }}
                    aria-label={`Delete ${s.name}`}
                    data-tip="Delete this sprite"
                  >
                    <Trash2 className="icon sm" />
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="cs-sprite add" onClick={() => setLibrary((v) => !v)} disabled={stage.sprites.length >= 40} data-testid="cs-add-sprite" data-tip="Add a sprite">
            <Plus className="icon" aria-hidden="true" />
            <span>Add</span>
          </button>
        </div>
        {library && (
          <div className="cs-library" ref={libraryRef} role="dialog" aria-label="Sprite library" data-testid="cs-library">
            <div className="cs-library-head">
              Choose a sprite
              <button type="button" className="btn ghost icon-only" onClick={() => setLibrary(false)} aria-label="Close">
                <X className="icon sm" />
              </button>
            </div>
            <div className="cs-library-grid">
              {CHARACTERS.map((ch) => {
                const c = COSTUMES.find((x) => x.id === ch.costumes[0])!;
                return (
                  <button key={ch.name} type="button" className="cs-sprite" onClick={() => addSprite(ch.name, ch.costumes)} data-testid={`cs-lib-${ch.name}`}>
                    <img src={artSrc(c)} alt="" draggable={false} />
                    <span>{ch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="cs-backdrops" aria-label="Backdrops">
          {stage.backdrops.map((id, i) => {
            const b = backdropById(id);
            return (
              <div key={id} className={`cs-backdrop${i === stage.backdrop ? ' on' : ''}`} data-testid={`cs-backdrop-${id}`}>
                <button type="button" onClick={() => onChange({ ...stage, backdrop: i })} data-tip={`${b?.name ?? id}: the backdrop at the start`}>
                  {b && <img src={artSrc(b)} alt={b.name} draggable={false} />}
                </button>
                {stage.backdrops.length > 1 && (
                  <button
                    type="button"
                    className="cs-remove"
                    onClick={() => onChange({ ...stage, backdrops: stage.backdrops.filter((x) => x !== id), backdrop: Math.max(0, Math.min(stage.backdrop, stage.backdrops.length - 2)) })}
                    aria-label={`Remove the backdrop ${b?.name ?? id}`}
                  >
                    <X className="icon sm" />
                  </button>
                )}
              </div>
            );
          })}
          <label className="picker cs-add-backdrop" data-tip="Add a backdrop">
            <ImagePlus className="icon" aria-hidden="true" />
            <span className="sr-only">Add a backdrop</span>
            <select value="" onChange={(e) => e.target.value && onChange({ ...stage, backdrops: [...stage.backdrops, e.target.value] })} data-testid="cs-add-backdrop">
              <option value="" disabled>
                Backdrop
              </option>
              {BACKDROPS.filter((b) => !stage.backdrops.includes(b.id)).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </aside>
    </section>
  );
}
