import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
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

const q = (p: string) => JSON.stringify(p);

function writeConfig(home: string, data: string): string {
  mkdirSync(join(home, 'downloads'), { recursive: true });
  mkdirSync(join(home, 'user', 'libraries'), { recursive: true });
  const file = join(home, 'arduino-cli.yaml');
  writeFileSync(
    file,
    ['directories:', `  data: ${q(data)}`, `  downloads: ${q(join(home, 'downloads'))}`, `  user: ${q(join(home, 'user'))}`, 'updater:', '  enable_notification: false', ''].join('\n'),
  );
  return file;
}

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * Make the toolchain that ships with the installer usable, and return the arduino-cli config
 * file to run with (undefined = no bundle: use arduino-cli's own defaults, as in development).
 *
 * The bundle (`resources/arduino-data` = cores and tools, `resources/arduino-libraries`) is
 * read-only once installed, and an AppImage mounts it at a different path on every start. So
 * it is copied once into the user's data folder, where board support installed later (ESP32)
 * and extra libraries also live. `resources/toolchain.json` identifies the bundle; a new app
 * version with a different bundle copies again, keeping anything the user installed.
 */
export async function prepareArduinoHome(resourcesDir: string, userDataDir: string, log: (line: string) => void = () => {}, useBundle = true): Promise<string | undefined> {
  const home = join(userDataDir, 'arduino');
  // Development/CI override: use this data directory in place, without copying.
  const override = process.env['TARIRO_ARDUINO_DATA'];
  if (override && existsSync(override)) return writeConfig(home, override);

  const bundledData = join(resourcesDir, 'arduino-data');
  if (!useBundle || !existsSync(bundledData)) return undefined;
  const data = join(home, 'data');
  const marker = join(data, '.tariro-bundle');
  const bundleId = readText(join(resourcesDir, 'toolchain.json')) ?? 'unversioned';
  if (readText(marker) !== bundleId) {
    log('Preparing the Arduino toolchain (first start only)…');
    await cp(bundledData, data, { recursive: true, force: true, verbatimSymlinks: true });
    writeFileSync(marker, bundleId);
  }
  const config = writeConfig(home, data);

  // Bundled libraries: add the ones that are missing or at another version than the bundle's.
  const bundledLibs = join(resourcesDir, 'arduino-libraries');
  if (existsSync(bundledLibs)) {
    const userLibs = join(home, 'user', 'libraries');
    for (const name of readdirSync(bundledLibs)) {
      const from = join(bundledLibs, name);
      const to = join(userLibs, name);
      const wanted = readText(join(from, 'library.properties'));
      if (wanted === undefined || wanted === readText(join(to, 'library.properties'))) continue;
      await rm(to, { recursive: true, force: true });
      await cp(from, to, { recursive: true });
    }
  }
  return config;
}
