import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeProject, newProject, type Project } from '@tariro-studio/core';
import { ProjectService } from '../src/main/services/projects.js';

let userData: string;
let docs: string;
const ws = (n: number) => ({ blocks: { languageVersion: 0, blocks: [{ type: 'tariro_on_start', id: `s${n}`, x: n, y: 0 }] } });
const project = (name = 'Robot'): Project => newProject({ board: 'tariro', workspace: ws(1), appVersion: '0.1.0', name });
const edit = (p: Project, n: number, at: string): Project => ({ ...p, workspace: ws(n), modifiedAt: at });

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'tariro-ud-'));
  docs = mkdtempSync(join(tmpdir(), 'tariro-docs-'));
});
afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
  rmSync(docs, { recursive: true, force: true });
});

describe('ProjectService: files', () => {
  it('saves and reopens a project (round trip through disk)', () => {
    const svc = new ProjectService(userData);
    svc.startSession();
    const p = project();
    const path = svc.grant(join(docs, 'robot.tsp'));
    svc.save(path, p, new Uint8Array([1, 2, 3]));
    const opened = new ProjectService(userData);
    opened.grant(path);
    const r = opened.open(path);
    expect(r.project).toEqual(p);
    expect(Array.from(r.thumbnail!)).toEqual([1, 2, 3]);
  });

  it('only touches paths the learner chose (dialog, recent list or OS open)', () => {
    const svc = new ProjectService(userData);
    const outside = join(docs, 'secret.tsp');
    expect(() => svc.save(outside, project())).toThrow(/not chosen/);
    expect(() => svc.open('/etc/passwd')).toThrow(/not chosen/);
    expect(existsSync(outside)).toBe(false);
  });

  it('writes atomically and leaves no temp files behind', () => {
    const svc = new ProjectService(userData);
    const path = svc.grant(join(docs, 'a.tsp'));
    svc.save(path, project());
    svc.save(path, project('Second'));
    expect(readdirSync(docs)).toEqual(['a.tsp']);
    expect(decodeProject(new Uint8Array(readFileSync(path))).project.name).toBe('Second');
  });

  it('keeps a recent list (newest first, missing files dropped) and grants its paths', () => {
    const svc = new ProjectService(userData);
    const a = svc.grant(join(docs, 'a.tsp'));
    const b = svc.grant(join(docs, 'b.tsp'));
    svc.save(a, project('A'));
    svc.save(b, project('B'));
    rmSync(a);
    const fresh = new ProjectService(userData);
    expect(fresh.recent().map((r) => r.name)).toEqual(['B']);
    expect(fresh.isGranted(b)).toBe(true);
  });

  it('reports a damaged file instead of crashing', () => {
    const svc = new ProjectService(userData);
    const bad = svc.grant(join(docs, 'bad.tsp'));
    writeFileSync(bad, 'not a zip');
    expect(() => svc.open(bad)).toThrow(/not a Tariro Studio project/);
  });
});

describe('ProjectService: autosave and crash recovery', () => {
  it('offers the newest autosave after a crash', () => {
    const run1 = new ProjectService(userData);
    run1.startSession();
    const p = project('Line follower');
    run1.autosave(edit(p, 2, '2026-11-15T10:00:00.000Z'), new Date('2026-11-15T10:00:00Z'));
    run1.autosave(edit(p, 3, '2026-11-15T10:00:30.000Z'), new Date('2026-11-15T10:00:30Z'));
    // …the app crashes: markCleanExit() is never called.

    const run2 = new ProjectService(userData);
    run2.startSession();
    const offers = run2.listRecoverable();
    expect(offers).toEqual([expect.objectContaining({ id: p.id, name: 'Line follower', modifiedAt: '2026-11-15T10:00:30.000Z' })]);
    expect(run2.recover(p.id).workspace).toEqual(ws(3));
    expect(run2.listRecoverable()).toEqual([]);
  });

  it('offers nothing after a clean exit', () => {
    const run1 = new ProjectService(userData);
    run1.startSession();
    run1.autosave(project());
    run1.markCleanExit();
    const run2 = new ProjectService(userData);
    run2.startSession();
    expect(run2.listRecoverable()).toEqual([]);
  });

  it('does not offer work that was saved after the last autosave', () => {
    const run1 = new ProjectService(userData);
    run1.startSession();
    const p = project();
    run1.autosave(edit(p, 2, '2026-11-15T10:00:00.000Z'));
    const path = run1.grant(join(docs, 'p.tsp'));
    run1.save(path, edit(p, 2, '2026-11-15T10:00:05.000Z'));
    const run2 = new ProjectService(userData);
    run2.startSession();
    expect(run2.listRecoverable()).toEqual([]);
  });

  it('remembers where an unsaved-then-recovered project was last saved', () => {
    const run1 = new ProjectService(userData);
    run1.startSession();
    const p = project();
    const path = run1.grant(join(docs, 'p.tsp'));
    run1.save(path, edit(p, 1, '2026-11-15T09:00:00.000Z'));
    run1.autosave(edit(p, 5, '2026-11-15T09:10:00.000Z'));
    const run2 = new ProjectService(userData);
    run2.startSession();
    expect(run2.listRecoverable()[0]?.savedPath).toBe(path);
  });

  it('keeps at most 20 snapshots per project', () => {
    const svc = new ProjectService(userData);
    const p = project();
    for (let i = 0; i < 25; i++) svc.autosave(edit(p, i, `2026-11-15T10:00:${String(i).padStart(2, '0')}.000Z`), new Date(Date.UTC(2026, 10, 15, 10, 0, i)));
    expect(readdirSync(join(userData, 'autosave', p.id)).filter((f) => f.endsWith('.tsp'))).toHaveLength(20);
  });

  it('skips a damaged snapshot rather than failing startup', () => {
    const run1 = new ProjectService(userData);
    run1.startSession();
    const p = project();
    run1.autosave(p);
    const dir = join(userData, 'autosave', p.id);
    for (const f of readdirSync(dir)) writeFileSync(join(dir, f), 'garbage');
    const run2 = new ProjectService(userData);
    expect(() => run2.startSession()).not.toThrow();
    expect(run2.listRecoverable()).toEqual([]);
  });
});
