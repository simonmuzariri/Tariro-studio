import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const exe = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';

/**
 * Locate arduino-cli, in order:
 * 1. TARIRO_ARDUINO_CLI (development and CI),
 * 2. the copy bundled with the app (resources/arduino-cli/<platform>-<arch>/),
 * 3. arduino-cli on PATH.
 */
export function findArduinoCli(resourcesDir: string): string | undefined {
  const fromEnv = process.env['TARIRO_ARDUINO_CLI'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const bundled = join(resourcesDir, 'arduino-cli', `${process.platform}-${process.arch}`, exe);
  if (existsSync(bundled)) return bundled;
  const probe = spawnSync(exe, ['version'], { windowsHide: true });
  return probe.status === 0 ? exe : undefined;
}

/**
 * When the app ships an offline Arduino data directory (cores + libraries), point arduino-cli at
 * it through a generated config file. Returns undefined to use arduino-cli's own defaults.
 */
export function arduinoConfigFile(resourcesDir: string, userDataDir: string): string | undefined {
  const data = process.env['TARIRO_ARDUINO_DATA'] ?? join(resourcesDir, 'arduino-data');
  if (!existsSync(data)) return undefined;
  const dir = join(userDataDir, 'arduino');
  mkdirSync(join(dir, 'downloads'), { recursive: true });
  mkdirSync(join(dir, 'user'), { recursive: true });
  const file = join(dir, 'arduino-cli.yaml');
  const q = (p: string) => JSON.stringify(p);
  writeFileSync(
    file,
    [
      'directories:',
      `  data: ${q(data)}`,
      `  downloads: ${q(join(dir, 'downloads'))}`,
      `  user: ${q(join(dir, 'user'))}`,
      'updater:',
      '  enable_notification: false',
      '',
    ].join('\n'),
  );
  return file;
}
