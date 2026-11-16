import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

// app-protocol imports electron; only the pure path resolver is under test here.
vi.mock('electron', () => ({ net: {}, protocol: {} }));
const { resolveInside } = await import('../src/main/app-protocol.js');

const root = join('/opt', 'tariro', 'renderer');

describe('resolveInside', () => {
  it('maps / to index.html', () => {
    expect(resolveInside(root, '/')).toBe(join(root, 'index.html'));
  });

  it('resolves nested assets', () => {
    expect(resolveInside(root, '/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'));
  });

  it('refuses path traversal, including encoded forms', () => {
    expect(resolveInside(root, '/../main/index.js')).toBeNull();
    expect(resolveInside(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveInside(root, '/assets/../../secret')).toBeNull();
  });
});
