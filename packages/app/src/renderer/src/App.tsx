import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Box, Camera, ChevronDown, CircleX, Code, Copy, FileCode2, GraduationCap, Languages, Minus, Moon, Octagon, Palette, Pencil, Square, Sun, Upload, TriangleAlert, Usb, X, Zap } from './ui/icons';
import {
  BOARDS,
  blockForLine,
  checkLive,
  EXPERIENCE_LEVELS,
  LEVEL_INFO,
  generateArduino,
  generateMicroPython,
  getBoard,
  type AppInfo,
  type Diagnostic,
  type ExperienceLevel,
  PYTHON_STARTER,
  defaultStage,
  type GeneratedProgram,
} from '@tariro-studio/core';
import { BlockWorkspace, type BlockWorkspaceHandle } from './blockly/BlockWorkspace';
import { CodePane } from './code/CodePane';
import { BuildBar } from './hardware/BuildBar';
import { BoardButton } from './hardware/BoardButton';
import { ConnectButton } from './hardware/ConnectButton';
import { Dock, type DockTab, type Problem } from './hardware/Dock';
import { SerialMonitor } from './hardware/SerialMonitor';
import { useSerial, useToolchain } from './hardware/useHardware';
import { useLive } from './hardware/useLive';
import { registry } from './registry';
import logo from './assets/logo.png';
import { SimulatorPane } from './sim/SimulatorPane';
import { useSimulation } from './sim/useSimulation';

// The 3D workbench (and three.js) loads only when it is first opened.
const Workbench = lazy(() => import('./bench/Workbench'));
// The Python environment (and its worker) loads only when it is first opened.
const PythonWorkspace = lazy(() => import('./python/PythonWorkspace'));
const CreativeStudio = lazy(() => import('./creative/CreativeStudio'));
// The AI panel (and TensorFlow.js) loads only when it is first opened.
const ClassifierPanel = lazy(() => import('./ai/ClassifierPanel'));
import type { RightView } from './ui/PaneTabs';
import { Splitter } from './ui/Splitter';
import { TooltipLayer } from './ui/Tooltip';
import { useLevel, useStoredChoice, useStoredNumber, useTheme } from './ui/theme';
import { usePython } from './python/usePython';
import { camera, useCamera } from './ai/camera';
import { FileMenu } from './project/FileMenu';
import { ChoiceDialog, ConfirmDialog, RecoveryDialog, Toast } from './project/Dialogs';
import { Plotter } from './hardware/Plotter';
import { t } from './i18n';
import { useProject } from './project/useProject';
import { ExtensionLibrary } from './project/ExtensionLibrary';

const EMPTY_WORKSPACE = {};

/** Workspace rectangle (CSS px) captured by main as the project thumbnail. */
function workspaceArea() {
  // Code-mode projects have no block workspace; use the code editor for their thumbnail.
  const r = (document.querySelector('[data-testid=block-workspace]') ?? document.querySelector('[data-testid=code-view]'))?.getBoundingClientRect();
  if (!r || r.width < 1 || r.height < 1) return null;
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

/** Window size, so stored panel sizes never push the workspace off a smaller screen. */
function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [level, setLevel] = useLevel();
  const win = useWindowSize();
  // The block workspace is the hero: the code column starts at about a third of the window.
  const [rightW, setRightW] = useStoredNumber('tariro.layout.codeWidth', Math.round(Math.min(560, Math.max(380, window.innerWidth * 0.34))));
  const [dockH, setDockH] = useStoredNumber('tariro.layout.dockHeight', 250);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [rightView, setRightView] = useState<RightView>('code');
  /**
   * Coding mode, as in other block-based studios: Stage (sprites and the board together, run from
   * this computer), Upload (the program goes onto the board) or Python (on this computer).
   */
  const [mode, setMode] = useStoredChoice<'stage' | 'upload' | 'python'>('tariro.mode', ['stage', 'upload', 'python'], 'upload');
  const [bench, setBench] = useState(false);
  useEffect(() => window.studio.window.onState((s) => setMaximized(s.maximized)), []);
  const proj = useProject(__APP_VERSION__, workspaceArea);
  const { project } = proj;
  const boardId = project.board;
  const setBoardId = proj.setBoard;
  const workspace = project.workspace ?? EMPTY_WORKSPACE;
  const [selected, setSelected] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  /** The port chosen with Connect, remembered on this computer (used again when that board is plugged in). */
  const [chosenPort, setPort] = useState(() => {
    try {
      return localStorage.getItem('tariro.port') ?? '';
    } catch {
      return '';
    }
  });
  const connectPort = useCallback((path: string) => {
    setPort(path);
    try {
      localStorage.setItem('tariro.port', path);
    } catch {
      /* not remembered */
    }
  }, []);
  const [tab, setTab] = useState<DockTab>('problems');
  const [showExtensions, setShowExtensions] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const cam = useCamera();
  /** The camera question waiting for an answer (the AI tools ask before the camera first turns on). */
  const [cameraAsk, setCameraAsk] = useState<((yes: boolean) => void) | null>(null);
  useEffect(() => {
    camera.askConsent = () => new Promise<boolean>((resolve) => setCameraAsk(() => resolve));
  }, []);
  const [askConvert, setAskConvert] = useState(false);
  const codeMode = project.mode === 'code';
  const centre: 'blocks' | 'bench' | 'python' | 'creative' = mode === 'stage' ? 'creative' : mode === 'python' ? 'python' : bench && !codeMode ? 'bench' : 'blocks';
  /** Compiler diagnostics and the exact code they belong to (stale once the blocks change). */
  const [built, setBuilt] = useState<{ code: string; diagnostics: Diagnostic[] } | null>(null);
  const blocks = useRef<BlockWorkspaceHandle>(null);
  const board = useMemo(() => getBoard(boardId), [boardId]);
  const toolchain = useToolchain(board.fqbn);
  const serial = useSerial();
  const highlightBlock = useCallback((id: string | null) => blocks.current?.highlight(id), []);
  const live = useLive({ log: toolchain.appendLog, onBlock: highlightBlock });
  const simulation = useSimulation({
    workspace,
    board,
    layout: project.circuit,
    log: toolchain.appendLog,
    onBlock: highlightBlock,
    blocked: live.phase !== 'idle' ? 'Stop live mode first.' : undefined,
  });

  // MicroPython only where the board supports it; anything else falls back to Arduino C++.
  const language = project.language === 'micropython' && board.languages.includes('micropython') ? 'micropython' : 'arduino';
  const program: GeneratedProgram = useMemo(
    () => (language === 'micropython' ? generateMicroPython : generateArduino)(workspace, board, registry, { serialBaud: project.serial.baud }),
    [language, workspace, board, project.serial.baud],
  );
  // A loaded project may use blocks from an extension it did not list; keep those in the toolbox too.
  const activeExtensions = useMemo(
    () => [...new Set([...project.extensions, ...program.extensions])].sort(),
    [project.extensions, program.extensions],
  );
  /** What gets compiled: the learner's own text in code mode, the generated sketch otherwise. */
  const code = codeMode ? (project.code ?? '') : program.code;
  const libraries = useMemo(
    () => (codeMode ? registry.librariesForExtensions(project.extensions, board) : program.libraries),
    [codeMode, project.extensions, board, program.libraries],
  );
  const diagnostics = useMemo(() => (built && built.code === code ? built.diagnostics : []), [built, code]);

  /** After a refused live start: what still stops this program from running live. */
  const liveRefusals = useMemo(() => (live.refused && !codeMode ? checkLive(workspace, board, registry) : []), [live.refused, codeMode, workspace, board]);

  const problems: Problem[] = useMemo(
    () => [
      ...diagnostics.map((d) => {
        const blockId = codeMode ? undefined : blockForLine(program.sourceMap, d.line);
        return { severity: d.severity, source: 'compiler' as const, message: d.message, line: d.line, ...(blockId ? { blockId } : {}) };
      }),
      ...(codeMode ? [] : program.warnings).map((w) => ({ severity: 'warning' as const, source: 'blocks' as const, message: w.message, ...(w.blockId ? { blockId: w.blockId } : {}) })),
      ...[...liveRefusals, ...live.problems].map((w) => ({ severity: 'error' as const, source: 'live' as const, message: w.message, ...(w.blockId ? { blockId: w.blockId } : {}) })),
    ],
    [diagnostics, program, codeMode, live.problems, liveRefusals],
  );

  // Show every problem on its block too.
  useEffect(() => {
    blocks.current?.showWarnings(
      problems.filter((p) => p.blockId).map((p) => ({ blockId: p.blockId!, message: p.source === 'compiler' ? `Compiler: ${p.message}` : p.message })),
    );
  }, [problems]);

  useEffect(() => {
    document.title = `${project.name}${proj.dirty ? ' ●' : ''} — Tariro Studio`;
  }, [project.name, proj.dirty]);

  useEffect(() => {
    window.studio.app.info().then(setInfo, () => setInfo(null));
  }, []);

  // The board is used only after Connect; a remembered port counts once that board is plugged in.
  const port = serial.ports.some((p) => p.path === chosenPort) ? chosenPort : '';

  const python = usePython({ port });
  const stageOrDefault = useMemo(() => project.stage ?? defaultStage(), [project.stage]);
  const pythonBusy = python.phase !== 'idle';

  // Live-mode problems describe the blocks as they were; any edit makes them stale.
  const { clearProblems: clearLiveProblems, stop: stopLive } = live;
  useEffect(() => clearLiveProblems(), [workspace, boardId, clearLiveProblems]);
  // Opening another project ends a live run.
  useEffect(() => stopLive, [proj.key, stopLive]);
  const liveAvailable = !codeMode && language === 'arduino' && board.family === 'avr';
  // Opening another project ends a simulation run, like a live run.
  const { stop: stopSim } = simulation;
  useEffect(() => stopSim, [proj.key, stopSim]);
  // ───────── safety (Phase 5a): heartbeat, settings, emergency stop ─────────
  /** True while a program drives the board over the live link (live mode, Stage mode, Python). */
  const [boardLinked, setBoardLinked] = useState(false);
  const [estop, setEstop] = useState(false);
  const [motorLimit, setMotorLimit] = useStoredNumber('tariro.safety.motorLimit', 100);
  useEffect(() => {
    // Twice a second: "the app is alive". If it stops (the app froze), the board is switched off.
    const t = setInterval(() => void window.studio.live.heartbeat(), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    void window.studio.live.setSafety({ boardId: board.id, motorSpeedLimit: Math.min(Math.max(Math.round(motorLimit), 10), 100) });
  }, [board.id, motorLimit]);
  const { appendLog } = toolchain;
  useEffect(
    () =>
      window.studio.live.onState((s) => {
        setBoardLinked(s.connected);
        if (s.estop !== undefined) setEstop(s.estop);
      }),
    [],
  );
  useEffect(
    () =>
      window.studio.live.onSafety((e) => {
        appendLog(e.message, e.kind === 'limited' ? 'info' : 'stderr');
      }),
    [appendLog],
  );
  const emergencyStop = useCallback(() => {
    void window.studio.live.emergencyStop();
    python.stop();
  }, [python]);
  // Esc is the emergency stop whenever a program is driving the board.
  useEffect(() => {
    if (!boardLinked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') emergencyStop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardLinked, emergencyStop]);

  const startLive = () => {
    if (pythonBusy) {
      // One program at a time uses the board link.
      setTab('output');
      toolchain.appendLog('Stop the Python program first: it is using the board.', 'stderr');
      return;
    }
    simulation.stop(); // one program at a time drives the block highlight
    setTab('output');
    void live.start(workspace, board, port).then((hasProblems) => hasProblems && setTab('problems'));
  };

  const focusProblem = useCallback((p: Problem) => {
    if (p.blockId) blocks.current?.focusBlock(p.blockId);
    setRevealLine(p.line ?? null);
  }, []);

  const build = async (kind: 'verify' | 'upload') => {
    setTab('output');
    const r =
      language === 'micropython'
        ? await toolchain.uploadMicroPython(code, port)
        : kind === 'verify'
          ? await toolchain.compile(code, project.id, libraries)
          : await toolchain.upload(code, project.id, port, libraries);
    setBuilt({ code, diagnostics: r.diagnostics });
    if (r.diagnostics.some((d) => d.severity === 'error')) setTab('problems');
  };

  // Keyboard shortcuts (File shortcuts live in the File menu): Verify, Upload, toolbox, panel.
  const shortcuts = useRef<Record<string, () => void>>({});
  useLayoutEffect(() => {
    const idle = toolchain.busy === false && live.phase === 'idle';
    shortcuts.current = {
      r: () => idle && language === 'arduino' && toolchain.status?.ready && void build('verify'),
      u: () => idle && port && (language === 'micropython' || toolchain.status?.ready) && void build('upload'),
      f: () => blocks.current?.focusSearch(),
      j: () => setDockCollapsed((c) => !c),
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const act = shortcuts.current[e.key.toLowerCase()];
      if (!act) return;
      e.preventDefault();
      act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showProblems = () => {
    setTab('problems');
    setDockCollapsed(false);
  };
  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const isMac = info?.platform === 'darwin';
  const codeWidth = Math.max(320, Math.min(rightW, win.w - 420));
  const panelHeight = Math.max(120, Math.min(dockH, win.h - 320));

  return (
    <div className="shell">
      <header className="titlebar" style={isMac ? { paddingLeft: 84 } : undefined}>
        <span className="brand" data-testid="brand">
          <img src={logo} alt="Tariro Studio" draggable={false} />
        </span>
        <label className="project-name" data-tip={proj.path ?? 'Not saved yet. Click to rename the project.'}>
          <input value={project.name} onChange={(e) => proj.setName(e.target.value)} aria-label="Project name" maxLength={120} spellCheck={false} size={Math.min(Math.max(project.name.length, 8), 40)} data-testid="project-name" />
          <Pencil className="icon sm" aria-hidden="true" />
          {proj.dirty && <span className="dirty" role="img" aria-label="Unsaved changes" data-tip="Unsaved changes" data-testid="dirty" />}
        </label>
        <div className="title-actions">
          <button type="button" className="title-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} data-tip={theme === 'dark' ? 'Light theme' : 'Dark theme'} data-testid="theme-toggle">
            {theme === 'dark' ? <Sun className="icon" /> : <Moon className="icon" />}
          </button>
          {!isMac && (
            <>
              <button type="button" className="title-btn" onClick={() => void window.studio.window.minimize()} aria-label="Minimise" data-testid="win-minimize">
                <Minus className="icon" />
              </button>
              <button type="button" className="title-btn" onClick={() => void window.studio.window.toggleMaximize().then(setMaximized)} aria-label={maximized ? 'Restore' : 'Maximise'} data-testid="win-maximize">
                {maximized ? <Copy className="icon sm" /> : <Square className="icon sm" />}
              </button>
              <button type="button" className="title-btn close" onClick={() => void window.studio.window.close()} aria-label="Close" data-testid="win-close">
                <X className="icon" />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="toolbar" role="toolbar" aria-label="Project">
        <FileMenu
          recent={proj.recent}
          onNew={proj.actions.newProject}
          onOpen={proj.actions.open}
          onOpenRecent={proj.actions.openPath}
          onExample={(ex) => {
            proj.actions.openExample(ex);
            if (ex.opensIn) setMode(ex.opensIn);
          }}
          onSave={proj.actions.save}
          onSaveAs={proj.actions.saveAs}
          onExport={() => void proj.actions.exportSketch(code, language === 'micropython' ? 'py' : 'ino')}
        />
        <span className="tb-sep" />
        <BoardButton boards={BOARDS} board={board} onChoose={setBoardId} disabled={toolchain.busy !== false || live.phase !== 'idle'} />
        <ConnectButton
          ports={serial.ports}
          port={port}
          onConnect={connectPort}
          onDisconnect={() => connectPort('')}
          disabled={toolchain.busy !== false || live.phase !== 'idle' || pythonBusy}
          motorLimit={motorLimit}
          onMotorLimit={setMotorLimit}
        />
        {!codeMode && mode !== 'python' && (
          <label className="picker narrow" data-tip={`Experience level: ${LEVEL_INFO[level].description}`}>
            <GraduationCap className="icon" aria-hidden="true" />
            <span className="sr-only">Experience level</span>
            <select value={level} onChange={(e) => setLevel(e.target.value as ExperienceLevel)} data-testid="level-select">
              {EXPERIENCE_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_INFO[l].name}
                </option>
              ))}
            </select>
            <ChevronDown className="icon sm chev" aria-hidden="true" />
          </label>
        )}
        {board.languages.length > 1 && mode === 'upload' && (
          <label className="picker narrow" data-tip={codeMode ? 'The language is fixed once a project is edited as code' : 'Language the blocks are turned into'}>
            <Languages className="icon" aria-hidden="true" />
            <span className="sr-only">Language</span>
            <select
              value={language}
              onChange={(e) => proj.setLanguage(e.target.value === 'micropython' ? 'micropython' : 'arduino')}
              data-testid="language-select"
              disabled={toolchain.busy !== false || codeMode}
            >
              <option value="arduino">Arduino C++</option>
              <option value="micropython">MicroPython</option>
            </select>
            <ChevronDown className="icon sm chev" aria-hidden="true" />
          </label>
        )}
        {mode === 'upload' && !codeMode && (
          <button type="button" className={`btn plain bench-toggle${bench ? ' on' : ''}`} aria-pressed={bench} onClick={() => setBench((v) => !v)} data-tip="Build and test the circuit on a 3D breadboard" data-testid="bench-toggle">
            <Box className="icon" aria-hidden="true" />
            Workbench
          </button>
        )}
        <BuildBar
          board={board}
          language={language}
          ports={serial.ports}
          port={port}
          onSwitchBoard={setBoardId}
          status={toolchain.status}
          busy={toolchain.busy}
          progress={toolchain.progress}
          result={toolchain.result}
          canBuild
          portOnly={mode !== 'upload'}
          onVerify={() => void build('verify')}
          onUpload={() => void build('upload')}
          onCancel={() => void toolchain.cancel()}
          onInstallPlatform={() => {
            setTab('output');
            void toolchain.installPlatform();
          }}
          {...(liveAvailable ? { live: { phase: live.phase, status: live.status, onStart: startLive, onStop: live.stop } } : {})}
        />
        {boardLinked && (
          <button type="button" className="btn estop" onClick={emergencyStop} data-tip="Emergency stop: switch every pin off now and keep the board off until Reset" data-keys="Esc" aria-label="Emergency stop" data-testid="estop">
            <Octagon className="icon" aria-hidden="true" />
            E-STOP
          </button>
        )}
        <span className="tb-sep" />
        <div className="segmented mode-switch" role="tablist" aria-label="Coding mode">
          <button type="button" role="tab" aria-selected={mode === 'stage'} className={mode === 'stage' ? 'on stage' : ''} onClick={() => setMode('stage')} data-tip="Stage: sprites, sounds and the board together, run from this computer" data-testid="mode-stage">
            <Palette className="icon" aria-hidden="true" />
            Stage
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'upload'}
            className={mode === 'upload' ? 'on' : ''}
            onClick={() => {
              setMode('upload');
              setBench(false);
            }}
            data-tip={codeMode ? 'Upload: edit the code for the board' : 'Upload: program the board with blocks and put the program on it'}
            data-testid="mode-upload"
          >
            <Upload className="icon" aria-hidden="true" />
            Upload
          </button>
          <button type="button" role="tab" aria-selected={mode === 'python'} className={mode === 'python' ? 'on' : ''} onClick={() => setMode('python')} data-tip="Python on this computer, with the board through the tariro module" data-testid="mode-python">
            <FileCode2 className="icon" aria-hidden="true" />
            Python
          </button>
        </div>
      </div>
      {estop && (
        <div className="estop-banner" role="alert" data-testid="estop-banner">
          <Octagon className="icon" aria-hidden="true" />
          <span>Emergency stop: the board is switched off and will not move until you reset.</span>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              void window.studio.live.resetEmergencyStop();
              setEstop(false);
            }}
            data-testid="estop-reset"
          >
            Reset
          </button>
        </div>
      )}
      <main className={`editor${codeMode ? ' code-mode' : ''}${centre === 'python' || centre === 'creative' ? ' python-mode' : ''}`} style={{ '--right-w': `${codeWidth}px` } as CSSProperties}>
        {centre === 'creative' && (
          <Suspense fallback={<div className="bench-loading">Loading Creative Studio…</div>}>
            <CreativeStudio
              key={proj.key}
              stage={stageOrDefault}
              onChange={proj.setStage}
              theme={theme}
              board={board}
              extensions={activeExtensions}
              level={level}
              port={port}
              onAddExtension={() => setShowExtensions(true)}
              ai={project.ai}
              onOpenAi={() => setShowAi(true)}
              blocked={live.phase !== 'idle' ? 'Stop live mode first: the stage uses the same board link.' : pythonBusy ? 'Stop the Python program first: it is using the board.' : undefined}
            />
          </Suspense>
        )}
        {centre === 'python' && (
          <Suspense fallback={<div className="bench-loading">Loading Python…</div>}>
            <PythonWorkspace
              key={proj.key}
              code={project.python ?? PYTHON_STARTER}
              onChange={proj.setPython}
              theme={theme}
              python={python}
              blocked={live.phase !== 'idle' ? 'Stop live mode first: Python uses the same board link.' : undefined}
            />
          </Suspense>
        )}
        {!codeMode && centre === 'bench' && (
          <Suspense fallback={<div className="bench-loading">Loading the workbench…</div>}>
            <Workbench
              board={board}
              workspace={workspace}
              theme={theme}
              layout={project.circuit}
              onChange={proj.setCircuit}
              simulation={simulation}
              blocked={live.phase !== 'idle' ? 'Stop live mode first.' : undefined}
            />
          </Suspense>
        )}
        {!codeMode && (
          <BlockWorkspace
            hidden={centre !== 'blocks'}
            onAddExtension={() => setShowExtensions(true)}
            key={proj.key}
            ref={blocks}
            board={board}
            extensions={activeExtensions}
            level={level}
            initial={workspace}
            theme={theme}
            onChange={proj.setWorkspace}
            onSelect={(id) => {
              setSelected(id);
              setRevealLine(null);
            }}
          />
        )}
        {!codeMode && centre !== 'python' && centre !== 'creative' && <Splitter direction="col" size={codeWidth} min={320} max={win.w - 420} onResize={setRightW} label="Resize the code panel" />}
        <div className={`code-column ${dockCollapsed ? 'dock-collapsed' : ''}`} hidden={centre === 'python' || centre === 'creative'} style={{ '--dock-h': `${panelHeight}px` } as CSSProperties}>
          <CodePane
            key={codeMode ? `code-${proj.key}` : 'blocks'}
            program={program}
            boardName={board.name}
            language={language}
            theme={theme}
            highlightBlockId={codeMode ? null : selected}
            revealLine={revealLine}
            diagnostics={diagnostics}
            {...(codeMode ? { editable: { code, onChange: proj.setCode } } : { onEditAsCode: () => setAskConvert(true), views: { view: rightView, onView: setRightView } })}
          />
          {!codeMode && (
            <SimulatorPane
              simulation={simulation}
              board={board}
              view={rightView}
              onView={setRightView}
              codeLabel={`${language === 'micropython' ? 'MicroPython' : 'Arduino C++'} · ${board.name}`}
              blocked={live.phase !== 'idle' ? 'Stop live mode first.' : undefined}
              onOpenBench={() => {
                setMode('upload');
                setBench(true);
              }}
            />
          )}
          <Splitter direction="row" size={panelHeight} min={120} max={win.h - 320} onResize={setDockH} label="Resize the bottom panel" />
          <Dock
            tab={tab}
            onTab={setTab}
            problems={problems}
            onProblemClick={focusProblem}
            log={toolchain.log}
            onClearLog={toolchain.clearLog}
            activity={
              toolchain.busy !== false
                ? { state: 'busy', label: toolchain.busy === 'install' ? 'Installing…' : toolchain.progress.phase === 'uploading' ? 'Uploading…' : 'Compiling…' }
                : live.phase !== 'idle'
                  ? { state: 'busy', label: live.phase === 'running' ? 'Running live' : 'Connecting…' }
                  : (toolchain.result && !toolchain.result.ok) || (live.status && !live.status.ok)
                    ? { state: 'failed', label: 'Failed' }
                    : { state: 'ready', label: 'Ready' }
            }
            collapsed={dockCollapsed}
            onToggleCollapsed={() => setDockCollapsed((c) => !c)}
            serial={
              <SerialMonitor
                port={port}
                state={serial.state}
                text={serial.text}
                defaultBaud={project.serial.baud}
                onOpen={(p, b) => void serial.open(p, b)}
                onClose={() => void serial.close()}
                onSend={(d) => void serial.write(d)}
                onClear={serial.clear}
              />
            }
            plotter={<Plotter text={serial.text} onClear={serial.clear} />}
          />
        </div>
      </main>
      <footer className="statusbar">
        <span className={`status-item ${port ? 'connected' : ''}`} data-tip={port ? 'A board is plugged in on the selected port' : 'Plug the board in with a USB cable'} data-testid="status-connection">
          <i className="dot" aria-hidden="true" />
          <span>{port ? `Board: ${board.name}` : 'No board connected'}</span>
        </span>
        {port && (
          <span className="status-item" data-tip="The USB port in use">
            <Usb className="icon" aria-hidden="true" />
            <span>Port: {port}</span>
          </span>
        )}
        {cam.on && (
          <span className="status-item camera-on" data-tip="The camera is on. Pictures stay on this computer." data-testid="camera-indicator">
            <Camera className="icon" aria-hidden="true" />
            <span>Camera on</span>
          </span>
        )}
        {live.phase === 'running' && (
          <span className="status-item live">
            <Zap className="icon" aria-hidden="true" />
            <span>LIVE</span>
          </span>
        )}
        {board.notes?.map((note) => (
          <span key={note} className="status-item warn board-note" data-tip={note}>
            <TriangleAlert className="icon" aria-hidden="true" />
            <span>pins unconfirmed</span>
          </span>
        ))}
        <span className="grow" />
        <button type="button" className="status-item" onClick={showProblems} data-tip="Show the problems" data-testid="status-problems">
          <CircleX className="icon" aria-hidden="true" />
          <span>{errorCount}</span>
          <TriangleAlert className="icon" aria-hidden="true" />
          <span>{problems.length - errorCount}</span>
        </button>
        <span className="status-item">
          <Code className="icon" aria-hidden="true" />
          <span>
            {language === 'micropython' ? 'MicroPython' : 'Arduino C++'} · {codeMode ? 'code' : 'blocks'}
          </span>
        </span>
        {info && (
          <span className="status-item version" data-testid="app-version" data-tip={`Electron ${info.versions.electron}`}>
            v{info.version}
          </span>
        )}
      </footer>
      {showAi && (
        <Suspense fallback={null}>
          <ClassifierPanel model={project.ai} onChange={proj.setAi} onClose={() => setShowAi(false)} />
        </Suspense>
      )}
      {cameraAsk && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-label="Use the camera?" data-testid="camera-consent">
            <h2>
              <Camera className="icon" aria-hidden="true" />
              Use the camera?
            </h2>
            <p>Tariro Studio would like to use your camera to teach and run your AI model. The pictures stay on this computer and are not sent anywhere. You can turn the camera off at any time.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  cameraAsk(false);
                  setCameraAsk(null);
                }}
                data-testid="camera-deny"
              >
                Not now
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  cameraAsk(true);
                  setCameraAsk(null);
                }}
                data-testid="camera-allow"
              >
                Use the camera
              </button>
            </div>
          </div>
        </div>
      )}
      {showExtensions && (
        <ExtensionLibrary
          board={board}
          enabled={project.extensions}
          inUse={codeMode ? [] : program.extensions}
          onChange={proj.setExtensions}
          onClose={() => setShowExtensions(false)}
        />
      )}
      {askConvert && (
        <ChoiceDialog
          title={t('code.convert.title')}
          message={t('code.convert.message')}
          confirmLabel={t('code.convert.confirm')}
          onCancel={() => setAskConvert(false)}
          onConfirm={() => {
            setAskConvert(false);
            setSelected(null);
            // The generated header tells learners to edit the blocks; that no longer applies.
            proj.convertToCode(
              program.code
                .replace(/^ \* Edit the blocks:.*$/m, ' * Converted from blocks. This code is now edited by hand.')
                .replace(/^# Edit the blocks:.*$/m, '# Converted from blocks. This code is now edited by hand.'),
              program.extensions,
            );
          }}
        />
      )}
      {live.needsFirmware && (
        <ChoiceDialog
          title={t('live.firmware.title')}
          message={t('live.firmware.message')}
          confirmLabel={t('live.firmware.confirm')}
          onCancel={live.dismissFirmware}
          onConfirm={() => {
            const target = live.needsFirmware!;
            live.dismissFirmware();
            setTab('output');
            void toolchain.installLiveFirmware(target).then((r) => {
              if (r.ok) void live.start(workspace, board, target);
            });
          }}
        />
      )}
      {proj.confirm && <ConfirmDialog confirm={proj.confirm} onCancel={proj.cancelConfirm} />}
      {proj.recoverable.length > 0 && !proj.confirm && (
        <RecoveryDialog items={proj.recoverable} onRecover={(id) => void proj.actions.recover(id)} onDismiss={proj.actions.dismissRecovery} />
      )}
      <TooltipLayer />
      <div className="toasts">
        {proj.error && <Toast kind="error" message={proj.error} onClose={proj.clearError} />}
        {proj.notice && <Toast kind="info" message={proj.notice} onClose={proj.clearNotice} />}
      </div>
    </div>
  );
}
