/**
 * Project files, autosave and crash recovery (IDE_DESIGN.md §9). No Electron imports: dialogs
 * live in main/index.ts, which grants the paths they return. The renderer can only open or
 * overwrite paths that were granted (dialog result, recent list, OS "open with").
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { decodeProject, encodeProject, ProjectFileError, type Project, type RecentProject, type RecoverableProject } from '@tariro-studio/core';

const MAX_AUTOSAVES_PER_PROJECT = 20;
const MAX_RECENT = 10;
const AUTOSAVE_RETENTION_DAYS = 30;

interface SessionFile {
  startedAt: string;
  cleanExit: boolean;
}

export class ProjectService {
  private readonly granted = new Set<string>();
  private readonly autosaveDir: string;
  private readonly sessionFile: string;
  private readonly recentFile: string;
  private recoverable: RecoverableProject[] = [];

  constructor(private readonly userData: string) {
    this.autosaveDir = join(userData, 'autosave');
    this.sessionFile = join(userData, 'session.json');
    this.recentFile = join(userData, 'recent.json');
    mkdirSync(this.autosaveDir, { recursive: true });
  }

  /**
   * Call once at startup. If the previous run did not exit cleanly (crash, power cut, killed),
   * collect autosaves that are newer than the last explicit save of each project.
   */
  startSession(now = new Date()): void {
    const previous = this.readJson<SessionFile>(this.sessionFile);
    this.recoverable = previous && !previous.cleanExit ? this.findRecoverable() : [];
    this.pruneOldAutosaves(now);
    this.writeJson(this.sessionFile, { startedAt: now.toISOString(), cleanExit: false } satisfies SessionFile);
  }

  /** Call when the app quits normally (including "don't save"). */
  markCleanExit(): void {
    const s = this.readJson<SessionFile>(this.sessionFile) ?? { startedAt: new Date().toISOString(), cleanExit: false };
    this.writeJson(this.sessionFile, { ...s, cleanExit: true });
  }

  grant(path: string): string {
    const p = resolve(path);
    this.granted.add(p);
    return p;
  }

  isGranted(path: string): boolean {
    return this.granted.has(resolve(path));
  }

  open(path: string): { path: string; project: Project; thumbnail?: Uint8Array } {
    const p = this.requireGranted(path);
    let bytes: Buffer;
    try {
      bytes = readFileSync(p);
    } catch (err) {
      throw new ProjectFileError('The project file could not be read. It may have been moved or deleted.', { cause: err });
    }
    const { project, thumbnail } = decodeProject(new Uint8Array(bytes));
    this.addRecent(p, project);
    return thumbnail ? { path: p, project, thumbnail } : { path: p, project };
  }

  /** Atomic save: write a temporary file next to the target, then rename over it. */
  save(path: string, project: Project, thumbnail?: Uint8Array): string {
    const p = this.requireGranted(path);
    const bytes = encodeProject(project, thumbnail);
    const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.tmp`);
    try {
      writeFileSync(tmp, bytes);
      renameSync(tmp, p);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw new ProjectFileError('The project could not be saved there. Choose another folder.', { cause: err });
    }
    this.writeJson(join(this.projectAutosaveDir(project.id), 'saved.json'), { modifiedAt: project.modifiedAt, path: p });
    this.addRecent(p, project);
    return p;
  }

  /** Snapshot for crash recovery; keeps the newest few per project. */
  autosave(project: Project, now = new Date()): string {
    const dir = this.projectAutosaveDir(project.id);
    const file = join(dir, `${now.toISOString().replace(/[:.]/g, '-')}.tsp`);
    writeFileSync(file, encodeProject(project));
    const snaps = this.snapshots(dir);
    for (const old of snaps.slice(0, Math.max(0, snaps.length - MAX_AUTOSAVES_PER_PROJECT))) rmSync(join(dir, old), { force: true });
    return file;
  }

  listRecoverable(): RecoverableProject[] {
    return this.recoverable;
  }

  recover(id: string): Project {
    const entry = this.recoverable.find((r) => r.id === id);
    if (!entry) throw new ProjectFileError('That recovered project is no longer available.');
    const { project } = decodeProject(new Uint8Array(readFileSync(entry.file)));
    this.recoverable = this.recoverable.filter((r) => r.id !== id);
    return project;
  }

  /** The learner chose not to recover: forget the offer (snapshots stay until pruned). */
  dismissRecovery(): void {
    this.recoverable = [];
  }

  recent(): RecentProject[] {
    const list = this.readJson<RecentProject[]>(this.recentFile) ?? [];
    const alive = list.filter((r) => existsSync(r.path)).slice(0, MAX_RECENT);
    for (const r of alive) this.grant(r.path);
    return alive;
  }

  writeText(path: string, text: string): string {
    const p = this.requireGranted(path);
    writeFileSync(p, text, 'utf8');
    return p;
  }

  // ───────────────────────── internals ─────────────────────────

  private requireGranted(path: string): string {
    const p = resolve(path);
    if (!this.granted.has(p)) throw new ProjectFileError('That file was not chosen in this session. Use Open… to pick it.');
    return p;
  }

  private projectAutosaveDir(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ProjectFileError('Invalid project id.');
    const dir = join(this.autosaveDir, id);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private snapshots(dir: string): string[] {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.tsp'))
      .sort();
  }

  private findRecoverable(): RecoverableProject[] {
    const out: RecoverableProject[] = [];
    for (const id of safeReaddir(this.autosaveDir)) {
      const dir = join(this.autosaveDir, id);
      const latest = this.snapshots(dir).at(-1);
      if (!latest) continue;
      try {
        const { project } = decodeProject(new Uint8Array(readFileSync(join(dir, latest))));
        const saved = this.readJson<{ modifiedAt: string; path?: string }>(join(dir, 'saved.json'));
        if (saved && saved.modifiedAt >= project.modifiedAt) continue; // nothing newer than the saved file
        const item: RecoverableProject = { id: project.id, name: project.name, modifiedAt: project.modifiedAt, file: join(dir, latest) };
        if (saved?.path) item.savedPath = saved.path;
        out.push(item);
      } catch {
        /* a damaged snapshot is skipped, never fatal */
      }
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  private pruneOldAutosaves(now: Date): void {
    const cutoff = now.getTime() - AUTOSAVE_RETENTION_DAYS * 86_400_000;
    const keep = new Set(this.recoverable.map((r) => r.id));
    for (const id of safeReaddir(this.autosaveDir)) {
      const dir = join(this.autosaveDir, id);
      if (keep.has(id)) continue;
      try {
        if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  private addRecent(path: string, project: Project): void {
    const list = (this.readJson<RecentProject[]>(this.recentFile) ?? []).filter((r) => r.path !== path);
    list.unshift({ path, name: project.name, modifiedAt: project.modifiedAt });
    this.writeJson(this.recentFile, list.slice(0, MAX_RECENT));
  }

  private readJson<T>(file: string): T | undefined {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  private writeJson(file: string, value: unknown): void {
    writeFileSync(file, JSON.stringify(value, null, 2));
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
