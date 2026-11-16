import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { decodeProject, encodeProject, fileNameFor, migrateProject, newProject, projectFingerprint, ProjectFileError } from '../src/project.js';

const workspace = { blocks: { languageVersion: 0, blocks: [{ type: 'tariro_on_start', id: 'a', x: 40, y: 40 }] } };
const base = () => newProject({ board: 'tariro', workspace, appVersion: '0.1.0', name: 'Line follower', now: new Date('2026-11-15T10:00:00Z') });

describe('.tsp project files', () => {
  it('round-trips a project and its thumbnail byte-for-byte', () => {
    const p = base();
    const thumb = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const decoded = decodeProject(encodeProject(p, thumb));
    expect(decoded.project).toEqual(p);
    expect(Array.from(decoded.thumbnail!)).toEqual(Array.from(thumb));
  });

  it('saves without a thumbnail', () => {
    const decoded = decodeProject(encodeProject(base()));
    expect(decoded.thumbnail).toBeUndefined();
  });

  it('gives new projects unique, file-safe ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => base().id));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('refuses files that are not projects, with a learner-friendly message', () => {
    expect(() => decodeProject(strToU8('hello'))).toThrow(ProjectFileError);
    expect(() => decodeProject(zipSync({ 'other.txt': strToU8('x') }))).toThrow(/project.json is missing/);
    expect(() => decodeProject(zipSync({ 'project.json': strToU8('{oops') }))).toThrow(/not valid JSON/);
    expect(() => migrateProject({ format: 'something-else' })).toThrow(/not a Tariro Studio project/);
  });

  it('refuses projects from a newer app version instead of half-reading them', () => {
    expect(() => migrateProject({ ...base(), formatVersion: 2 })).toThrow(/newer version/);
  });

  it('reports which field is damaged', () => {
    expect(() => migrateProject({ ...base(), name: '' })).toThrow(/damaged/);
  });

  it('fingerprints content, not timestamps', () => {
    const a = base();
    const b = { ...a, modifiedAt: '2030-01-01T00:00:00Z', appVersion: '9.9.9' };
    expect(projectFingerprint(a)).toBe(projectFingerprint(b));
    expect(projectFingerprint({ ...a, name: 'Other' })).not.toBe(projectFingerprint(a));
    expect(projectFingerprint({ ...a, board: 'arduino-uno' })).not.toBe(projectFingerprint(a));
  });

  it('derives safe file names', () => {
    expect(fileNameFor('Line follower: v2!', '.ino')).toBe('Line-follower-v2.ino');
    expect(fileNameFor('***', '.tsp')).toBe('project.tsp');
  });
});
