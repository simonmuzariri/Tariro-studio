import { ArrowLeftRight, ChevronDown, CircleCheck, CircleX, Download, LoaderCircle, Play, Square, TriangleAlert, Upload, Usb, X, Zap } from 'lucide-react';
import { BOARDS, TOOLCHAIN_PINS, type BoardDefinition, type BuildResult, type EventPayload, type PortInfo, type ToolchainStatus } from '@tariro-studio/core';

interface Props {
  board: BoardDefinition;
  /** MicroPython needs no compile step and no Arduino toolchain. */
  language: 'arduino' | 'micropython';
  ports: PortInfo[];
  port: string;
  onPortChange(path: string): void;
  onSwitchBoard(boardId: string): void;
  status: ToolchainStatus | null;
  busy: false | 'compile' | 'upload' | 'install';
  progress: EventPayload<'toolchain:progress'>;
  result: BuildResult | null;
  canBuild: boolean;
  onVerify(): void;
  onUpload(): void;
  onCancel(): void;
  /** Download the missing board support named by `status.missingPlatform`. */
  onInstallPlatform(): void;
  /** Live mode (blocks run on the PC, board driven over Firmata). Absent when it does not apply. */
  live?: {
    phase: 'idle' | 'connecting' | 'running';
    status: { ok: boolean; message: string } | null;
    onStart(): void;
    onStop(): void;
  };
}

/** Port picker, Verify/Upload/Cancel and the build status, in the menu bar. */
export function BuildBar(p: Props) {
  const selected = p.ports.find((x) => x.path === p.port);
  const mismatch = selected?.suggestedBoardId && selected.suggestedBoardId !== p.board.id ? selected.suggestedBoardId : undefined;
  const python = p.language === 'micropython';
  const toolchainReady = python || p.status?.ready === true;
  // Board support the app can download (ESP32 is not part of the installer). MicroPython needs none.
  const needsSupport = !python && p.status?.missingPlatform !== undefined;
  const sizeHint = p.status?.missingPlatform ? TOOLCHAIN_PINS.platforms[p.status.missingPlatform]?.sizeHint : undefined;
  const liveBusy = p.live !== undefined && p.live.phase !== 'idle';
  const blockedReason = !toolchainReady
    ? p.status?.problem ?? 'Checking the Arduino toolchain…'
    : !p.canBuild
      ? 'Fix the problems in your program first.'
      : undefined;

  return (
    <div className="build-bar">
      <label className="picker" data-tip="Port: the USB connection to your board">
        <Usb className="icon" aria-hidden="true" />
        <span className="sr-only">Port</span>
        <select value={p.port} onChange={(e) => p.onPortChange(e.target.value)} data-testid="port-select" disabled={p.busy !== false || liveBusy}>
          {p.ports.length === 0 && <option value="">No board connected</option>}
          {p.ports.length > 0 && !p.port && <option value="">Choose a port…</option>}
          {p.ports.map((x) => (
            <option key={x.path} value={x.path}>
              {x.label}
            </option>
          ))}
        </select>
        <ChevronDown className="icon sm chev" aria-hidden="true" />
      </label>
      {mismatch && (
        <button
          type="button"
          className="chip"
          onClick={() => p.onSwitchBoard(mismatch)}
          data-tip={`This port looks like a ${BOARDS.find((b) => b.id === mismatch)?.name ?? mismatch}. Click to switch board.`}
          data-testid="switch-board"
        >
          <ArrowLeftRight className="icon sm" aria-hidden="true" />
          Looks like a {BOARDS.find((b) => b.id === mismatch)?.name ?? mismatch}: switch board
        </button>
      )}
      <div className="build-mid">
        {liveBusy || (p.busy === false && p.live?.status) ? (
          <span className={`build-status ${liveBusy || p.live!.status!.ok ? 'ok' : 'bad'}`} role="status" data-testid="build-status" data-tip={p.live!.status?.message}>
            {p.live!.phase === 'connecting' ? <LoaderCircle className="icon sm spin" /> : liveBusy ? <Zap className="icon sm" /> : p.live!.status!.ok ? <CircleCheck className="icon sm" /> : <CircleX className="icon sm" />}
            <span>{p.live!.phase === 'connecting' ? 'Live: connecting…' : p.live!.phase === 'running' ? `Live: running on ${p.port}` : p.live!.status!.message}</span>
          </span>
        ) : (
          <BuildStatus busy={p.busy} progress={p.progress} result={p.result} problem={toolchainReady ? undefined : p.status?.problem} />
        )}
      </div>
      {liveBusy ? (
        <button type="button" className="btn primary" onClick={p.live!.onStop} disabled={p.live!.phase !== 'running'} data-tip="Stop the program and switch every pin off" data-testid="live-stop">
          <Square className="icon sm" fill="currentColor" />
          Stop live
        </button>
      ) : p.busy === false && needsSupport ? (
        <button
          type="button"
          className="btn primary"
          onClick={p.onInstallPlatform}
          data-tip={`${p.status?.problem ?? ''} Download and install it now (needs the internet${sizeHint ? `, ${sizeHint}` : ''}).`}
          data-testid="install-platform"
        >
          <Download className="icon" />
          Install board support
        </button>
      ) : p.busy === false ? (
        <>
          {!python && (
            <button type="button" className="btn verify" onClick={p.onVerify} disabled={!!blockedReason} data-tip={blockedReason ?? 'Check that the program compiles'} data-keys="Ctrl+R" data-testid="verify">
              <CircleCheck className="icon" />
              Verify
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={p.onUpload}
            disabled={!!blockedReason || !p.port}
            data-tip={blockedReason ?? (p.port ? (python ? `Save to the board on ${p.port} and run` : `Upload to ${p.port}`) : 'Connect a board and choose its port')}
            data-keys="Ctrl+U"
            data-testid="upload"
          >
            {python ? <Play className="icon" fill="currentColor" /> : <Upload className="icon" />}
            {python ? 'Run on board' : 'Upload'}
          </button>
          {p.live && (
            <button
              type="button"
              className="btn"
              onClick={p.live.onStart}
              disabled={!p.port}
              data-tip={p.port ? 'Run the blocks from this computer and watch the board react at once. Needs the live firmware on the board.' : 'Connect a board and choose its port'}
              data-testid="live-start"
            >
              <Play className="icon" />
              Run live
            </button>
          )}
        </>
      ) : (
        <button type="button" className="btn" onClick={p.onCancel} data-tip="Stop what is running" data-testid="cancel">
          <X className="icon" />
          Cancel
        </button>
      )}
    </div>
  );
}

function BuildStatus({ busy, progress, result, problem }: { busy: Props['busy']; progress: Props['progress']; result: BuildResult | null; problem: string | undefined }) {
  if (busy) {
    const label = busy === 'install' ? 'Installing board support' : progress.phase === 'uploading' ? 'Uploading' : 'Compiling';
    return (
      <span className="build-status" role="status" data-testid="build-status">
        <LoaderCircle className="icon sm spin" aria-hidden="true" />
        <span>{label}…</span>
        <progress max={100} value={progress.phase === 'uploading' ? progress.percent : undefined} />
      </span>
    );
  }
  if (result)
    return (
      <span className={`build-status ${result.ok ? 'ok' : 'bad'}`} role="status" data-testid="build-status" data-tip={result.message}>
        {result.ok ? <CircleCheck className="icon sm" aria-hidden="true" /> : <CircleX className="icon sm" aria-hidden="true" />}
        <span>{result.message}</span>
      </span>
    );
  if (problem)
    return (
      <span className="build-status bad" role="status" data-testid="build-status" data-tip={problem}>
        <TriangleAlert className="icon sm" aria-hidden="true" />
        <span>{problem}</span>
      </span>
    );
  return null;
}
