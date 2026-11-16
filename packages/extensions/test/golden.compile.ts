/**
 * Compiles every golden program for every board it lists with a real arduino-cli
 * (`npm run test:compile`). Locates the CLI via $ARDUINO_CLI or PATH. Without one the suite
 * fails in CI and is skipped locally with a clear message.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateArduino, getBoard } from '@tariro-studio/core';
import { createRegistry } from '../src/index.js';
import { EXAMPLES as GOLDEN_PROGRAMS } from '../src/examples.js';

function findCli(): string | undefined {
  const candidate = process.env['ARDUINO_CLI'] ?? 'arduino-cli';
  const probe = spawnSync(candidate, ['version'], { encoding: 'utf8' });
  return probe.status === 0 ? candidate : undefined;
}

const cli = findCli();
const registry = createRegistry();

/** Installed cores, e.g. "arduino:avr", "esp32:esp32". Boards without their core are skipped (reported). */
function installedPlatforms(): Set<string> {
  if (!cli) return new Set();
  const r = spawnSync(cli, ['core', 'list', '--json'], { encoding: 'utf8' });
  try {
    return new Set((JSON.parse(r.stdout) as { platforms?: Array<{ id: string; installed_version?: string }> }).platforms?.filter((p) => p.installed_version).map((p) => p.id) ?? []);
  } catch {
    return new Set();
  }
}
const platforms = installedPlatforms();
const platformOf = (fqbn: string) => fqbn.split(':').slice(0, 2).join(':');
const cases = GOLDEN_PROGRAMS.flatMap((p) => p.boards.map((board) => ({ program: p, board, installed: platforms.has(platformOf(getBoard(board).fqbn)) })));
const requireAllCores = process.env['TARIRO_REQUIRE_ALL_CORES'] === '1';

if (!cli && process.env['CI']) throw new Error('arduino-cli not found (set ARDUINO_CLI) — required in CI');

describe.skipIf(!cli)('golden sketches compile with arduino-cli', () => {
  for (const { program, board, installed } of cases) {
  // A board whose core is missing is reported as skipped (or fails with TARIRO_REQUIRE_ALL_CORES=1).
  const title = installed ? `${program.name} for ${board}` : `${program.name} for ${board} (core ${platformOf(getBoard(board).fqbn)} not installed)`;
  (installed || requireAllCores ? it : it.skip)(title, () => {
    const def = getBoard(board);
    const { code, libraries } = generateArduino(program.workspace, def, registry);
    // Same as the IDE: install the pinned libraries the program needs first.
    for (const lib of libraries) execFileSync(cli!, ['lib', 'install', `${lib.name}@${lib.version}`], { stdio: 'ignore', timeout: 180_000 });
    const dir = mkdtempSync(join(tmpdir(), 'tariro-golden-'));
    try {
      const sketch = join(dir, 'sketch');
      mkdirSync(sketch);
      writeFileSync(join(sketch, 'sketch.ino'), code);
      let output = '';
      try {
        output = execFileSync(cli!, ['compile', '--fqbn', def.fqbn, '--build-path', join(dir, 'build'), sketch], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 180_000,
        });
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string };
        throw new Error(`Compile failed for ${program.name} on ${board}:\n${err.stdout ?? ''}\n${err.stderr ?? ''}\n--- sketch ---\n${code}`, { cause: e });
      }
      expect(output).toMatch(/Sketch uses \d+ bytes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  }
});
