/**
 * Compile and upload through arduino-cli (IDE_DESIGN.md §8). No Electron imports, so it is unit
 * tested in Node against a fake CLI.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  explainFailure,
  parseDiagnostics,
  parseSizes,
  parseUploadPercent,
  type BuildResult,
  type CompileRequest,
  type EventPayload,
  type ToolchainStatus,
  type UploadRequest,
} from '@tariro-studio/core';
import { CancellableProcess } from './process.js';

export interface ToolchainEvents {
  log(e: EventPayload<'toolchain:log'>): void;
  progress(e: EventPayload<'toolchain:progress'>): void;
}

export interface ToolchainOptions {
  /** arduino-cli executable, or undefined when none was found. */
  cliPath: string | undefined;
  /** Optional arduino-cli config file (bundled offline data directory). */
  configFile?: string;
  /** Where sketches and build output go (one folder per project). */
  workDir: string;
  events: ToolchainEvents;
  /** Close the Serial Monitor on `port` before uploading; resolves to a function that reopens it. */
  releasePort?(port: string): Promise<() => Promise<void>>;
}

const SKETCH = 'sketch';

export class ToolchainService {
  private readonly proc = new CancellableProcess();
  private busy = false;

  constructor(private readonly opts: ToolchainOptions) {}

  private baseArgs(): string[] {
    return this.opts.configFile ? ['--config-file', this.opts.configFile] : [];
  }

  status(fqbn?: string): ToolchainStatus {
    const cli = this.opts.cliPath;
    if (!cli) return { ready: false, cliPath: null, version: null, platforms: [], problem: 'The Arduino toolchain (arduino-cli) was not found.' };
    const v = spawnSync(cli, [...this.baseArgs(), 'version', '--json'], { encoding: 'utf8', windowsHide: true });
    if (v.status !== 0) return { ready: false, cliPath: cli, version: null, platforms: [], problem: 'arduino-cli could not be started.' };
    let version: string | null = null;
    try {
      version = (JSON.parse(v.stdout) as { VersionString?: string }).VersionString ?? null;
    } catch {
      /* version stays unknown */
    }
    const list = spawnSync(cli, [...this.baseArgs(), 'core', 'list', '--json'], { encoding: 'utf8', windowsHide: true });
    let platforms: string[] = [];
    try {
      const parsed = JSON.parse(list.stdout) as { platforms?: Array<{ id: string; installed_version?: string }> };
      platforms = (parsed.platforms ?? []).filter((p) => p.installed_version).map((p) => `${p.id}@${p.installed_version}`);
    } catch {
      /* none */
    }
    const needed = fqbn?.split(':').slice(0, 2).join(':');
    if (needed && !platforms.some((p) => p.startsWith(`${needed}@`)))
      return { ready: false, cliPath: cli, version, platforms, problem: `Support for ${needed} boards is not installed.` };
    return { ready: true, cliPath: cli, version, platforms };
  }

  async compile(req: CompileRequest): Promise<BuildResult> {
    return this.exclusive(() => this.doCompile(req));
  }

  async upload(req: UploadRequest): Promise<BuildResult> {
    return this.exclusive(async () => {
      const built = await this.doCompile(req);
      if (!built.ok) return built;
      return this.doUpload(req, built);
    });
  }

  cancel(): boolean {
    return this.proc.cancel();
  }

  private async exclusive(job: () => Promise<BuildResult>): Promise<BuildResult> {
    if (this.busy)
      return { ok: false, phase: 'error', message: 'Another compile or upload is still running.', diagnostics: [] };
    this.busy = true;
    try {
      return await job();
    } finally {
      this.busy = false;
    }
  }

  private paths(projectId: string) {
    const root = join(this.opts.workDir, projectId);
    return { sketchDir: join(root, SKETCH), build: join(root, 'build') };
  }

  private log(line: string, stream: 'stdout' | 'stderr' | 'info' = 'info') {
    this.opts.events.log({ line, stream });
  }

  private async doCompile(req: CompileRequest): Promise<BuildResult> {
    const cli = this.opts.cliPath;
    if (!cli) return { ok: false, phase: 'error', message: 'The Arduino toolchain (arduino-cli) was not found.', diagnostics: [] };
    const { sketchDir, build } = this.paths(req.projectId);
    mkdirSync(sketchDir, { recursive: true });
    mkdirSync(build, { recursive: true });
    writeFileSync(join(sketchDir, `${SKETCH}.ino`), req.code);

    this.opts.events.progress({ phase: 'compiling' });
    const libProblem = await this.ensureLibraries(req.libraries ?? []);
    if (libProblem) return this.finish({ ok: false, phase: 'error', message: libProblem, diagnostics: [] });
    this.log(`Compiling for ${req.fqbn}…`);
    const r = await this.proc.run(cli, [...this.baseArgs(), 'compile', '--fqbn', req.fqbn, '--build-path', build, '--warnings', 'default', sketchDir], (line, stream) =>
      this.log(line, stream),
    );
    const diagnostics = parseDiagnostics(r.output, `${SKETCH}.ino`);
    if (r.cancelled) return this.finish({ ok: false, phase: 'cancelled', message: 'Compiling was cancelled.', diagnostics });
    if (r.code !== 0) return this.finish({ ok: false, phase: 'error', message: explainFailure(r.output, 'compiling'), diagnostics });
    const sizes = parseSizes(r.output);
    const pct = sizes ? ` (${Math.round((100 * sizes.flash) / sizes.flashMax)}% of the board's memory)` : '';
    const result: BuildResult = { ok: true, phase: 'done', message: `Compiled successfully${pct}.`, diagnostics };
    if (sizes) result.sizes = sizes;
    return this.finish(result);
  }

  /** Install pinned libraries the program needs that are missing (or at another version). */
  private async ensureLibraries(libs: Array<{ name: string; version: string }>): Promise<string | undefined> {
    if (libs.length === 0) return undefined;
    const cli = this.opts.cliPath!;
    const listed = spawnSync(cli, [...this.baseArgs(), 'lib', 'list', '--json'], { encoding: 'utf8', windowsHide: true });
    const installed = new Map<string, string>();
    try {
      const parsed = JSON.parse(listed.stdout) as { installed_libraries?: Array<{ library: { name: string; version: string } }> };
      for (const l of parsed.installed_libraries ?? []) installed.set(l.library.name, l.library.version);
    } catch {
      /* treat as none installed */
    }
    for (const lib of libs) {
      if (installed.get(lib.name) === lib.version) continue;
      this.log(`Installing library ${lib.name} ${lib.version}…`);
      const r = await this.proc.run(cli, [...this.baseArgs(), 'lib', 'install', `${lib.name}@${lib.version}`], (line, stream) => this.log(line, stream));
      if (r.cancelled) return 'Cancelled while installing libraries.';
      if (r.code !== 0)
        return `The library "${lib.name}" is needed but could not be installed. Connect to the internet once, or ask your teacher for the offline library pack.`;
    }
    return undefined;
  }

  private async doUpload(req: UploadRequest, built: BuildResult): Promise<BuildResult> {
    const cli = this.opts.cliPath!;
    const { sketchDir, build } = this.paths(req.projectId);
    if (!existsSync(build)) return this.finish({ ok: false, phase: 'error', message: 'Nothing to upload: compile first.', diagnostics: [] });

    const reopen = (await this.opts.releasePort?.(req.port)) ?? (async () => {});
    try {
      this.opts.events.progress({ phase: 'uploading', percent: 0 });
      this.log(`Uploading to ${req.port}…`);
      const r = await this.proc.run(
        cli,
        [...this.baseArgs(), 'upload', '-p', req.port, '--fqbn', req.fqbn, '--input-dir', build, sketchDir],
        (line, stream) => {
          this.log(line, stream);
          const pct = parseUploadPercent(line);
          if (pct !== undefined) this.opts.events.progress({ phase: 'uploading', percent: pct });
        },
      );
      if (r.cancelled) return this.finish({ ok: false, phase: 'cancelled', message: 'Uploading was cancelled.', diagnostics: [] });
      if (r.code !== 0) return this.finish({ ok: false, phase: 'error', message: explainFailure(r.output, 'uploading'), diagnostics: [] });
      const result: BuildResult = { ok: true, phase: 'done', message: 'Uploaded! Your program is running on the board.', diagnostics: built.diagnostics };
      if (built.sizes) result.sizes = built.sizes;
      return this.finish(result);
    } finally {
      await reopen();
    }
  }

  private finish(result: BuildResult): BuildResult {
    this.opts.events.progress({ phase: result.phase });
    this.log(result.message);
    return result;
  }
}
