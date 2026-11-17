import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Blocks as BlocksIcon, Box, ChevronDown, CircleX, Code, Copy, Cpu, Languages, Minus, Moon, Pencil, Puzzle, Square, Sun, TriangleAlert, Usb, X, Zap } from 'lucide-react';
import {
  BOARDS,
  blockForLine,
  checkLive,
  generateArduino,
  generateMicroPython,
  getBoard,
  type AppInfo,
  type Diagnostic,
  type GeneratedProgram,
} from '@tariro-studio/core';
import { BlockWorkspace, type BlockWorkspaceHandle } from './blockly/BlockWorkspace';
import { CodePane } from './code/CodePane';
import { BuildBar } from './hardware/BuildBar';
import { Dock, type DockTab, type Problem } from './hardware/Dock';
import { SerialMonitor } from './hardware/SerialMonitor';
import { useSerial, useToolchain } from './hardware/useHardware';
import { useLive } from './hardware/useLive';
import { registry } from './registry';
import logoDark from './assets/logo-dark.png';
import { SimulatorPane } from './sim/SimulatorPane';
import { useSimulation } from './sim/useSimulation';

// The 3D workbench (and three.js) loads only when it is first opened.
const Workbench = lazy(() => import('./bench/Workbench'));
import type { RightView } from './ui/PaneTabs';
import { Splitter } from './ui/Splitter';
import { TooltipLayer } from './ui/Tooltip';
import { useStoredNumber, useTheme } from './ui/theme';
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
  const win = useWindowSize();
  // The block workspace is the hero: the code column starts at about a third of the window.
  const [rightW, setRightW] = useStoredNumber('tariro.layout.codeWidth', Math.round(Math.min(560, Math.max(380, window.innerWidth * 0.34))));
  const [dockH, setDockH] = useStoredNumber('tariro.layout.dockHeight', 250);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [rightView, setRightView] = useState<RightView>('code');
  const [centre, setCentre] = useState<'blocks' | 'bench'>('blocks');
  useEffect(() => window.studio.window.onState((s) => setMaximized(s.maximized)), []);
  const proj = useProject(__APP_VERSION__, workspaceArea);
  const { project } = proj;
  const boardId = project.board;
  const setBoardId = proj.setBoard;
  const workspace = project.workspace ?? EMPTY_WORKSPACE;
  const [selected, setSelected] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [chosenPort, setPort] = useState('');
  const [tab, setTab] = useState<DockTab>('problems');
  const [showExtensions, setShowExtensions] = useState(false);
  const [askConvert, setAskConvert] = useState(false);
  const codeMode = project.mode === 'code';
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

  // The chosen port while it is plugged in; otherwise the only connected board, if exactly one.
  const port = serial.ports.some((p) => p.path === chosenPort)
    ? chosenPort
    : serial.ports.length === 1
      ? serial.ports[0]!.path
      : '';

  // Live-mode problems describe the blocks as they were; any edit makes them stale.
  const { clearProblems: clearLiveProblems, stop: stopLive } = live;
  useEffect(() => clearLiveProblems(), [workspace, boardId, clearLiveProblems]);
  // Opening another project ends a live run.
  useEffect(() => stopLive, [proj.key, stopLive]);
  const liveAvailable = !codeMode && language === 'arduino' && board.family === 'avr';
  // Opening another project ends a simulation run, like a live run.
  const { stop: stopSim } = simulation;
  useEffect(() => stopSim, [proj.key, stopSim]);
  const startLive = () => {
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
      b: () => blocks.current?.toggleToolbox(),
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
          <img src={logoDark} alt="Tariro Studio" draggable={false} />
        </span>
        <span className="title-sep" aria-hidden="true" />
        <label className="project-name" data-tip={proj.path ?? 'Not saved yet. Click to rename the project.'}>
          <input value={project.name} onChange={(e) => proj.setName(e.target.value)} aria-label="Project name" maxLength={120} spellCheck={false} size={Math.min(Math.max(project.name.length, 8), 40)} data-testid="project-name" />
          <Pencil className="icon sm" aria-hidden="true" />
          {proj.dirty && <span className="dirty" role="img" aria-label="Unsaved changes" data-tip="Unsaved changes" data-testid="dirty" />}
        </label>
        {/* The red sweep from the logo, as a quiet accent across the bar. */}
        <svg className="title-swoosh" viewBox="0 0 320 44" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 44 C 120 44, 190 30, 250 0 L 320 0 C 250 34, 150 44, 0 44 Z" fill="currentColor" />
        </svg>
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
          onExample={proj.actions.openExample}
          onSave={proj.actions.save}
          onSaveAs={proj.actions.saveAs}
          onExport={() => void proj.actions.exportSketch(code, language === 'micropython' ? 'py' : 'ino')}
        />
        <button type="button" className="btn" onClick={() => setShowExtensions(true)} data-tip="Add blocks for the parts in your kit" data-testid="extensions-button">
          <Puzzle className="icon" aria-hidden="true" />
          Extensions
        </button>
        {!codeMode && (
          <div className="segmented" role="tablist" aria-label="Main area">
            <button type="button" role="tab" aria-selected={centre === 'blocks'} className={centre === 'blocks' ? 'on' : ''} onClick={() => setCentre('blocks')} data-tip="Program with blocks" data-testid="centre-blocks">
              <BlocksIcon className="icon sm" aria-hidden="true" />
              Blocks
            </button>
            <button type="button" role="tab" aria-selected={centre === 'bench'} className={centre === 'bench' ? 'on' : ''} onClick={() => setCentre('bench')} data-tip="Build the circuit on a 3D breadboard" data-testid="centre-bench">
              <Box className="icon sm" aria-hidden="true" />
              Workbench
            </button>
          </div>
        )}
        <span className="tb-sep" />
        <label className="picker" data-tip="Board: the kit board you are programming">
          <Cpu className="icon" aria-hidden="true" />
          <span className="sr-only">Board</span>
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)} data-testid="board-select" disabled={toolchain.busy !== false || live.phase !== 'idle'}>
            {BOARDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <ChevronDown className="icon sm chev" aria-hidden="true" />
        </label>
        {board.languages.length > 1 && (
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
        <BuildBar
          board={board}
          language={language}
          ports={serial.ports}
          port={port}
          onPortChange={setPort}
          onSwitchBoard={setBoardId}
          status={toolchain.status}
          busy={toolchain.busy}
          progress={toolchain.progress}
          result={toolchain.result}
          canBuild
          onVerify={() => void build('verify')}
          onUpload={() => void build('upload')}
          onCancel={() => void toolchain.cancel()}
          onInstallPlatform={() => {
            setTab('output');
            void toolchain.installPlatform();
          }}
          {...(liveAvailable ? { live: { phase: live.phase, status: live.status, onStart: startLive, onStop: live.stop } } : {})}
        />
      </div>
      <main className={codeMode ? 'editor code-mode' : 'editor'} style={{ '--right-w': `${codeWidth}px` } as CSSProperties}>
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
            hidden={centre === 'bench'}
            key={proj.key}
            ref={blocks}
            board={board}
            extensions={activeExtensions}
            initial={workspace}
            theme={theme}
            onChange={proj.setWorkspace}
            onSelect={(id) => {
              setSelected(id);
              setRevealLine(null);
            }}
          />
        )}
        {!codeMode && <Splitter direction="col" size={codeWidth} min={320} max={win.w - 420} onResize={setRightW} label="Resize the code panel" />}
        <div className={`code-column ${dockCollapsed ? 'dock-collapsed' : ''}`} style={{ '--dock-h': `${panelHeight}px` } as CSSProperties}>
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
              onOpenBench={() => setCentre('bench')}
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
