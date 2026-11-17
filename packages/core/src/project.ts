/**
 * Tariro Studio project files (`.tsp`, IDE_DESIGN.md §9): a zip holding `project.json` and an
 * optional `thumbnail.png`. Pure TypeScript (fflate), so the format is tested in Node and shared
 * by main and renderer.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { PRODUCT } from './product.js';
import { CircuitLayoutSchema } from './sim/layout.js';

export const PROJECT_FORMAT = PRODUCT.projectFormat;
export const PROJECT_FORMAT_VERSION = PRODUCT.projectFormatVersion;

const MAX_ENTRY_BYTES = 20 * 1024 * 1024; // refuse zip bombs / absurd files
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

export const ProjectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const ProjectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(1),
  appVersion: z.string(),
  id: ProjectIdSchema,
  name: z.string().trim().min(1).max(120),
  board: z.string().min(1).max(64),
  extensions: z.array(z.string().max(64)).max(64),
  mode: z.enum(['blocks', 'code']),
  /** Target language; absent means Arduino C++ (projects saved before MicroPython support). */
  language: z.enum(['arduino', 'micropython']).optional(),
  /** Blockly.serialization.workspaces.save() output. */
  workspace: z.record(z.string(), z.unknown()).optional(),
  code: z.string().max(2_000_000).optional(),
  /** The workbench: parts on the breadboard and wires (Simulation Lab). Absent until the learner builds one. */
  circuit: CircuitLayoutSchema.optional(),
  serial: z.object({ baud: z.number().int().positive() }),
  createdAt: z.string(),
  modifiedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export class ProjectFileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProjectFileError';
  }
}

export function newProjectId(): string {
  // Web Crypto exists in Node ≥19, Electron and browsers; core has no DOM lib, so type it locally.
  const { crypto } = globalThis as unknown as { crypto: { randomUUID(): string } };
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

export function newProject(opts: {
  board: string;
  workspace: Record<string, unknown>;
  appVersion: string;
  name?: string;
  extensions?: string[];
  now?: Date;
}): Project {
  const now = (opts.now ?? new Date()).toISOString();
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    appVersion: opts.appVersion,
    id: newProjectId(),
    name: opts.name ?? 'My Project',
    board: opts.board,
    extensions: opts.extensions ?? [],
    mode: 'blocks',
    workspace: opts.workspace,
    serial: { baud: 9600 },
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Bring any supported project.json up to the current format. Each future format version adds one
 * step here (v1 → v2 → …); files from a newer app are refused rather than half-read.
 */
export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError('This file does not contain a Tariro Studio project.');
  const r = raw as { format?: unknown; formatVersion?: unknown };
  if (r.format !== PROJECT_FORMAT) throw new ProjectFileError('This file is not a Tariro Studio project.');
  if (typeof r.formatVersion !== 'number') throw new ProjectFileError('This project file is damaged (no format version).');
  if (r.formatVersion > PROJECT_FORMAT_VERSION)
    throw new ProjectFileError('This project was made with a newer version of Tariro Studio. Please update the app to open it.');
  const parsed = ProjectSchema.safeParse(raw);
  if (!parsed.success) throw new ProjectFileError(`This project file is damaged: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function encodeProject(project: Project, thumbnail?: Uint8Array): Uint8Array {
  const valid = ProjectSchema.parse(project);
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(valid, null, 2)) };
  if (thumbnail && thumbnail.byteLength > 0 && thumbnail.byteLength <= MAX_THUMBNAIL_BYTES) files['thumbnail.png'] = thumbnail;
  return zipSync(files, { level: 6, mtime: new Date(valid.modifiedAt) });
}

export function decodeProject(bytes: Uint8Array): { project: Project; thumbnail?: Uint8Array } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => (f.name === 'project.json' || f.name === 'thumbnail.png') && f.originalSize <= MAX_ENTRY_BYTES,
    });
  } catch (err) {
    throw new ProjectFileError('This file is not a Tariro Studio project (it is not a valid .tsp archive).', { cause: err });
  }
  const json = entries['project.json'];
  if (!json) throw new ProjectFileError('This file is not a Tariro Studio project (project.json is missing).');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(json));
  } catch (err) {
    throw new ProjectFileError('This project file is damaged (project.json is not valid JSON).', { cause: err });
  }
  const project = migrateProject(raw);
  const thumbnail = entries['thumbnail.png'];
  return thumbnail ? { project, thumbnail } : { project };
}

/** Content identity for "unsaved changes": ignores timestamps and app version. */
export function projectFingerprint(p: Pick<Project, 'name' | 'board' | 'extensions' | 'mode' | 'workspace' | 'code' | 'serial' | 'circuit'>): string {
  // Block positions are part of the workspace, so moving blocks counts as a change (as learners expect).
  return JSON.stringify([p.name, p.board, p.extensions, p.mode, p.workspace ?? null, p.code ?? null, p.serial.baud, p.circuit ?? null]);
}

/** A safe file name for exports derived from the project name. */
export function fileNameFor(name: string, ext: string): string {
  const base = name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'project';
  return `${base}${ext}`;
}
