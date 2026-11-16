import { BOARDS, type BoardDefinition, type BuildResult, type EventPayload, type PortInfo, type ToolchainStatus } from '@tariro-studio/core';

interface Props {
  board: BoardDefinition;
  ports: PortInfo[];
  port: string;
  onPortChange(path: string): void;
  onSwitchBoard(boardId: string): void;
  status: ToolchainStatus | null;
  busy: false | 'compile' | 'upload';
  progress: EventPayload<'toolchain:progress'>;
  result: BuildResult | null;
  canBuild: boolean;
  onVerify(): void;
  onUpload(): void;
  onCancel(): void;
}

/** Port picker, Verify/Upload/Cancel and the build status, in the menu bar. */
export function BuildBar(p: Props) {
  const selected = p.ports.find((x) => x.path === p.port);
  const mismatch = selected?.suggestedBoardId && selected.suggestedBoardId !== p.board.id ? selected.suggestedBoardId : undefined;
  const toolchainReady = p.status?.ready === true;
  const blockedReason = !toolchainReady
    ? p.status?.problem ?? 'Checking the Arduino toolchain…'
    : !p.canBuild
      ? 'Fix the problems in your program first.'
      : undefined;

  return (
    <div className="build-bar">
      <label className="board-picker">
        <span>Port</span>
        <select value={p.port} onChange={(e) => p.onPortChange(e.target.value)} data-testid="port-select" disabled={p.busy !== false}>
          {p.ports.length === 0 && <option value="">No board connected</option>}
          {p.ports.length > 0 && !p.port && <option value="">Choose a port…</option>}
          {p.ports.map((x) => (
            <option key={x.path} value={x.path}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      {mismatch && (
        <button type="button" className="chip" onClick={() => p.onSwitchBoard(mismatch)} data-testid="switch-board">
          Looks like a {BOARDS.find((b) => b.id === mismatch)?.name ?? mismatch} — switch board
        </button>
      )}
      {p.busy === false ? (
        <>
          <button type="button" className="btn" onClick={p.onVerify} disabled={!!blockedReason} title={blockedReason ?? 'Check that the program compiles'} data-testid="verify">
            ✓ Verify
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={p.onUpload}
            disabled={!!blockedReason || !p.port}
            title={blockedReason ?? (p.port ? `Upload to ${p.port}` : 'Connect a board and choose its port')}
            data-testid="upload"
          >
            ▶ Upload
          </button>
        </>
      ) : (
        <button type="button" className="btn" onClick={p.onCancel} data-testid="cancel">
          ■ Cancel
        </button>
      )}
      <BuildStatus busy={p.busy} progress={p.progress} result={p.result} problem={toolchainReady ? undefined : p.status?.problem} />
    </div>
  );
}

function BuildStatus({ busy, progress, result, problem }: { busy: Props['busy']; progress: Props['progress']; result: BuildResult | null; problem: string | undefined }) {
  if (busy) {
    const label = progress.phase === 'uploading' ? 'Uploading' : 'Compiling';
    return (
      <span className="build-status" role="status" data-testid="build-status">
        {label}…
        <progress max={100} value={progress.phase === 'uploading' ? progress.percent : undefined} />
      </span>
    );
  }
  if (result)
    return (
      <span className={`build-status ${result.ok ? 'ok' : 'bad'}`} role="status" data-testid="build-status">
        {result.ok ? '✔' : '✖'} {result.message}
      </span>
    );
  if (problem)
    return (
      <span className="build-status bad" role="status" data-testid="build-status">
        {problem}
      </span>
    );
  return null;
}
