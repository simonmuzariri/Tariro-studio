import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareArduinoHome } from '../src/main/services/cli-path.js';
import { ToolchainService } from '../src/main/services/toolchain.js';
import { fakeCliPath } from './fixtures/fake-cli.js';

/** A miniature installer bundle: one core file and one library. */
function bundle(coreFile = 'v1', libVersion = '1.3.0') {
  const resources = mkdtempSync(join(tmpdir(), 'tariro-res-'));
  mkdirSync(join(resources, 'arduino-data/packages/arduino/hardware/avr/1.8.7'), { recursive: true });
  writeFileSync(join(resources, 'arduino-data/packages/arduino/hardware/avr/1.8.7/boards.txt'), coreFile);
  mkdirSync(join(resources, 'arduino-libraries/Servo'), { recursive: true });
  writeFileSync(join(resources, 'arduino-libraries/Servo/library.properties'), `name=Servo\nversion=${libVersion}\n`);
  writeFileSync(join(resources, 'toolchain.json'), JSON.stringify({ core: coreFile }));
  return resources;
}
const read = (p: string) => readFileSync(p, 'utf8');

describe('prepareArduinoHome', () => {
  it('copies the bundle into the user folder once and points arduino-cli at it', async () => {
    const resources = bundle();
    const user = mkdtempSync(join(tmpdir(), 'tariro-user-'));
    const log: string[] = [];
    const config = await prepareArduinoHome(resources, user, (l) => log.push(l));
    expect(config).toBe(join(user, 'arduino/arduino-cli.yaml'));
    expect(read(config!)).toContain(`data: ${JSON.stringify(join(user, 'arduino/data'))}`);
    expect(read(config!)).toContain(`user: ${JSON.stringify(join(user, 'arduino/user'))}`);
    expect(read(join(user, 'arduino/data/packages/arduino/hardware/avr/1.8.7/boards.txt'))).toBe('v1');
    expect(read(join(user, 'arduino/user/libraries/Servo/library.properties'))).toContain('1.3.0');
    expect(log).toEqual(['Preparing the Arduino toolchain (first start only)…']);

    // A second start does not copy again: a file the user's toolchain changed stays as it is.
    writeFileSync(join(user, 'arduino/data/packages/arduino/hardware/avr/1.8.7/boards.txt'), 'edited');
    await prepareArduinoHome(resources, user, (l) => log.push(l));
    expect(log).toHaveLength(1);
    expect(read(join(user, 'arduino/data/packages/arduino/hardware/avr/1.8.7/boards.txt'))).toBe('edited');
  });

  it('an app update with a new bundle refreshes it and keeps what the user installed', async () => {
    const user = mkdtempSync(join(tmpdir(), 'tariro-user-'));
    await prepareArduinoHome(bundle('v1', '1.3.0'), user);
    // Installed later by the user: ESP32 support and a library of their own.
    mkdirSync(join(user, 'arduino/data/packages/esp32'), { recursive: true });
    writeFileSync(join(user, 'arduino/data/packages/esp32/keep'), 'x');
    mkdirSync(join(user, 'arduino/user/libraries/Mine'), { recursive: true });
    writeFileSync(join(user, 'arduino/user/libraries/Servo/stale-file'), 'x');

    await prepareArduinoHome(bundle('v2', '1.4.0'), user);
    expect(read(join(user, 'arduino/data/packages/arduino/hardware/avr/1.8.7/boards.txt'))).toBe('v2');
    expect(existsSync(join(user, 'arduino/data/packages/esp32/keep'))).toBe(true);
    expect(read(join(user, 'arduino/user/libraries/Servo/library.properties'))).toContain('1.4.0');
    expect(existsSync(join(user, 'arduino/user/libraries/Servo/stale-file'))).toBe(false);
    expect(existsSync(join(user, 'arduino/user/libraries/Mine'))).toBe(true);
  });

  it('without a bundle arduino-cli keeps its own defaults', async () => {
    const user = mkdtempSync(join(tmpdir(), 'tariro-user-'));
    expect(await prepareArduinoHome(mkdtempSync(join(tmpdir(), 'tariro-res-')), user)).toBeUndefined();
    expect(await prepareArduinoHome(bundle(), user, undefined, false)).toBeUndefined();
    expect(existsSync(join(user, 'arduino'))).toBe(false);
  });
});

describe('installing board support', () => {
  const service = (dir: string, log: string[] = []) =>
    new ToolchainService({ cliPath: fakeCliPath(), workDir: dir, events: { log: (e) => log.push(e.line), progress: () => {} } });

  it('reports ESP32 support as missing but installable, installs the pinned core, and is then ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tariro-core-'));
    process.env['FAKE_CLI_STATE'] = dir;
    process.env['FAKE_CLI_RECORD'] = join(dir, 'calls.jsonl');
    try {
      const t = service(dir);
      expect(t.status('esp32:esp32:esp32s3')).toMatchObject({ ready: false, missingPlatform: 'esp32:esp32', problem: 'Support for ESP32 boards is not installed.' });
      expect(t.status('arduino:avr:uno').ready).toBe(true);
      const r = await t.installPlatform('esp32:esp32:esp32s3');
      expect(r).toMatchObject({ ok: true, message: 'Support for ESP32 boards is installed.' });
      const calls = read(join(dir, 'calls.jsonl')).trim().split('\n').map((l) => JSON.parse(l) as string[]);
      const install = calls.find((c) => c[1] === 'install')!;
      expect(install.slice(0, 3)).toEqual(['core', 'install', 'esp32:esp32@3.3.10']);
      expect(install).toContain('https://espressif.github.io/arduino-esp32/package_esp32_index.json');
      expect(t.status('esp32:esp32:esp32s3').ready).toBe(true);
    } finally {
      delete process.env['FAKE_CLI_STATE'];
      delete process.env['FAKE_CLI_RECORD'];
    }
  });

  it('explains a failed download and refuses unknown platforms', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tariro-core-'));
    process.env['FAKE_CLI_MODE'] = 'offline';
    try {
      expect(await service(dir).installPlatform('esp32:esp32:esp32s3')).toMatchObject({ ok: false, message: 'Support for ESP32 boards could not be installed. Check the internet connection and try again.' });
    } finally {
      delete process.env['FAKE_CLI_MODE'];
    }
    expect((await service(dir).installPlatform('acme:weird:board')).message).toContain('does not know how to install');
    expect(service(dir).status('acme:weird:board').missingPlatform).toBeUndefined();
  });
});
