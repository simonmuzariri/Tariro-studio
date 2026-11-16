import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARDS,
  blockForLine,
  generateArduino,
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
import { registry } from './registry';
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

export function App() {
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

  const program: GeneratedProgram = useMemo(() => generateArduino(workspace, board, registry, { serialBaud: project.serial.baud }), [workspace, board, project.serial.baud]);
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

  const problems: Problem[] = useMemo(
    () => [
      ...diagnostics.map((d) => {
        const blockId = codeMode ? undefined : blockForLine(program.sourceMap, d.line);
        return { severity: d.severity, source: 'compiler' as const, message: d.message, line: d.line, ...(blockId ? { blockId } : {}) };
      }),
      ...(codeMode ? [] : program.warnings).map((w) => ({ severity: 'warning' as const, source: 'blocks' as const, message: w.message, ...(w.blockId ? { blockId: w.blockId } : {}) })),
    ],
    [diagnostics, program, codeMode],
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

  const focusProblem = useCallback((p: Problem) => {
    if (p.blockId) blocks.current?.focusBlock(p.blockId);
    setRevealLine(p.line ?? null);
  }, []);

  const build = async (kind: 'verify' | 'upload') => {
    setTab('output');
    const r = kind === 'verify' ? await toolchain.compile(code, project.id, libraries) : await toolchain.upload(code, project.id, port, libraries);
    setBuilt({ code, diagnostics: r.diagnostics });
    if (r.diagnostics.some((d) => d.severity === 'error')) setTab('problems');
  };

  return (
    <div className="shell">
      <header className="menubar">
        <span className="brand">Tariro Studio</span>
        <FileMenu
          recent={proj.recent}
          onNew={proj.actions.newProject}
          onOpen={proj.actions.open}
          onOpenRecent={proj.actions.openPath}
          onExample={proj.actions.openExample}
          onSave={proj.actions.save}
          onSaveAs={proj.actions.saveAs}
          onExport={() => void proj.actions.exportSketch(code)}
        />
        <button type="button" className="btn" onClick={() => setShowExtensions(true)} data-testid="extensions-button">
          ＋ Extensions
        </button>
        <label className="project-name" title={proj.path ?? 'Not saved yet'}>
          <input value={project.name} onChange={(e) => proj.setName(e.target.value)} aria-label="Project name" maxLength={120} data-testid="project-name" />
          {proj.dirty && (
            <span className="dirty" title="Unsaved changes" data-testid="dirty">
              ●
            </span>
          )}
        </label>
        <label className="board-picker">
          <span>Board</span>
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)} data-testid="board-select" disabled={toolchain.busy !== false}>
            {BOARDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <BuildBar
          board={board}
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
        />
        <span className="spacer" />
        {board.notes?.map((note) => (
          <span key={note} className="board-note" title={note}>
            ⚠ pins unconfirmed
          </span>
        ))}
        {info && (
          <span className="version" data-testid="app-version" title={`Electron ${info.versions.electron}`}>
            v{info.version}
          </span>
        )}
      </header>
      <main className={codeMode ? 'editor code-mode' : 'editor'}>
        {!codeMode && (
          <BlockWorkspace
            key={proj.key}
            ref={blocks}
            board={board}
            extensions={activeExtensions}
            initial={workspace}
            onChange={proj.setWorkspace}
            onSelect={(id) => {
              setSelected(id);
              setRevealLine(null);
            }}
          />
        )}
        <div className="code-column">
          <CodePane
            key={codeMode ? `code-${proj.key}` : 'blocks'}
            program={program}
            boardName={board.name}
            highlightBlockId={codeMode ? null : selected}
            revealLine={revealLine}
            diagnostics={diagnostics}
            {...(codeMode ? { editable: { code, onChange: proj.setCode } } : { onEditAsCode: () => setAskConvert(true) })}
          />
          <Dock
            tab={tab}
            onTab={setTab}
            problems={problems}
            onProblemClick={focusProblem}
            log={toolchain.log}
            onClearLog={toolchain.clearLog}
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
              program.code.replace(/^ \* Edit the blocks:.*$/m, ' * Converted from blocks. This code is now edited by hand.'),
              program.extensions,
            );
          }}
        />
      )}
      {proj.confirm && <ConfirmDialog confirm={proj.confirm} onCancel={proj.cancelConfirm} />}
      {proj.recoverable.length > 0 && !proj.confirm && (
        <RecoveryDialog items={proj.recoverable} onRecover={(id) => void proj.actions.recover(id)} onDismiss={proj.actions.dismissRecovery} />
      )}
      <div className="toasts">
        {proj.error && <Toast kind="error" message={proj.error} onClose={proj.clearError} />}
        {proj.notice && <Toast kind="info" message={proj.notice} onClose={proj.clearNotice} />}
      </div>
    </div>
  );
}
