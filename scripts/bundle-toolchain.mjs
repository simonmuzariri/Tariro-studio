#!/usr/bin/env node
/**
 * Build the toolchain bundle that installers ship (run on the OS you are packaging for):
 *
 *   resources/arduino-cli/<platform>-<arch>/arduino-cli[.exe]   pinned arduino-cli, checksum-verified
 *   resources/arduino-data/                                      pinned cores and their tools
 *   resources/arduino-libraries/                                 pinned libraries the block packs need
 *   resources/toolchain.json                                     what is inside (also the bundle id)
 *
 * Usage: npm run build && node scripts/bundle-toolchain.mjs [--cli <existing arduino-cli>]
 * Needs the internet. Nothing here is committed; see .gitignore.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { TOOLCHAIN_PINS } = await import('../packages/core/dist/index.js');
const { FIRST_PARTY_EXTENSIONS } = await import('../packages/extensions/dist/index.js');

const key = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
const resources = join(root, 'resources');
const cliDir = join(resources, 'arduino-cli', key);
const cli = join(cliDir, exe);

/** Official release archives of arduino-cli 1.3.1 and their SHA-256 (from the release's checksums file). */
const ARCHIVES = {
  'linux-x64': ['arduino-cli_1.3.1_Linux_64bit.tar.gz', '376428d7d45be640c00812a71612e1742edc2f5f9ee3742a2d6da7870e079588'],
  'linux-arm64': ['arduino-cli_1.3.1_Linux_ARM64.tar.gz', 'cf4f668b1add7a20310d79e83a1f3eb148031f95e5673d9171c65f5e9a126a94'],
  'win32-x64': ['arduino-cli_1.3.1_Windows_64bit.zip', 'cfece6f356fdc9ca003cc3f0a488470030719c8e0e7bfce5e42ac9410d87441f'],
  'darwin-x64': ['arduino-cli_1.3.1_macOS_64bit.tar.gz', 'a0ca73f7e599d33a532fb2b1f8af9260541d990a684988bf8208abb42be83ced'],
  'darwin-arm64': ['arduino-cli_1.3.1_macOS_ARM64.tar.gz', '723f8ddaf4875e87a20380c88c15ff9d55916c3c80cb432f1f980ea32cec2341'],
};

const say = (m) => console.log(`[bundle] ${m}`);
const die = (m) => {
  console.error(`[bundle] ${m}`);
  process.exit(1);
};
/** Run arduino-cli; downloads are retried, since one dropped connection should not lose the whole bundle. */
function run(args, attempts = 4) {
  for (let i = 1; ; i++) {
    const r = spawnSync(cli, args, { stdio: 'inherit', windowsHide: true });
    if (r.status === 0) return;
    if (i >= attempts) die(`arduino-cli ${args.join(' ')} failed ${attempts} times`);
    say(`retrying (${i}/${attempts - 1}): arduino-cli ${args.slice(2).join(' ')}`);
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
  }
}
const cliVersion = () => {
  const r = spawnSync(cli, ['version', '--json'], { encoding: 'utf8', windowsHide: true });
  try {
    return JSON.parse(r.stdout).VersionString;
  } catch {
    return undefined;
  }
};

// ───────────────────────── 1. arduino-cli ─────────────────────────
if (TOOLCHAIN_PINS.arduinoCli !== '1.3.1') die('Update ARCHIVES (file names and checksums) for the new arduino-cli version.');
const given = process.argv.indexOf('--cli');
if (given > 0) {
  mkdirSync(cliDir, { recursive: true });
  cpSync(process.argv[given + 1], cli);
  if (process.platform !== 'win32') chmodSync(cli, 0o755);
}
if (cliVersion() === TOOLCHAIN_PINS.arduinoCli) say(`arduino-cli ${TOOLCHAIN_PINS.arduinoCli} already in ${cliDir}`);
else {
  const archive = ARCHIVES[key];
  if (!archive) die(`No arduino-cli archive is listed for ${key}.`);
  const [name, sha256] = archive;
  say(`downloading ${name}`);
  const res = await fetch(`https://downloads.arduino.cc/arduino-cli/${name}`);
  if (!res.ok) die(`download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== sha256) die(`checksum mismatch for ${name}: expected ${sha256}, got ${got}`);
  const tmp = mkdtempSync(join(tmpdir(), 'tariro-cli-'));
  writeFileSync(join(tmp, name), bytes);
  // bsdtar (Windows 10+, macOS) and GNU tar both unpack these; bsdtar also reads .zip.
  const t = spawnSync('tar', ['-xf', join(tmp, name), '-C', tmp], { stdio: 'inherit' });
  if (t.status !== 0) die('could not unpack the archive');
  mkdirSync(cliDir, { recursive: true });
  cpSync(join(tmp, exe), cli);
  if (process.platform !== 'win32') chmodSync(cli, 0o755);
  rmSync(tmp, { recursive: true, force: true });
  if (cliVersion() !== TOOLCHAIN_PINS.arduinoCli) die('the downloaded arduino-cli does not report the pinned version');
}

// ───────────────────────── 2. cores and libraries ─────────────────────────
const data = join(resources, 'arduino-data');
const libraries = join(resources, 'arduino-libraries');
rmSync(data, { recursive: true, force: true });
rmSync(libraries, { recursive: true, force: true });
const work = mkdtempSync(join(tmpdir(), 'tariro-bundle-'));
const config = join(work, 'arduino-cli.yaml');
const q = JSON.stringify;
writeFileSync(config, ['directories:', `  data: ${q(data)}`, `  downloads: ${q(join(work, 'downloads'))}`, `  user: ${q(join(work, 'user'))}`, ''].join('\n'));
const cfg = ['--config-file', config];

const platforms = Object.entries(TOOLCHAIN_PINS.platforms).filter(([, p]) => p.bundled);
run([...cfg, 'core', 'update-index']);
for (const [id, p] of platforms) {
  say(`installing core ${id}@${p.version}`);
  run([...cfg, 'core', 'install', `${id}@${p.version}`]);
}

// Libraries the bundled board families can use, at the versions the block packs pin.
const families = new Set(platforms.map(([id]) => (id === 'arduino:avr' ? 'avr' : id.split(':')[0])));
const libs = new Map();
for (const ext of FIRST_PARTY_EXTENSIONS)
  for (const lib of ext.libraries ?? []) if (!lib.families || lib.families.some((f) => families.has(f))) libs.set(lib.name, lib.version);
for (const lib of TOOLCHAIN_PINS.extraLibraries) libs.set(lib.name, lib.version);
run([...cfg, 'lib', 'update-index']);
for (const [name, version] of libs) {
  say(`installing library ${name}@${version}`);
  // --no-deps: every dependency is pinned explicitly above, so nothing floats to "latest".
  run([...cfg, 'lib', 'install', `${name}@${version}`, '--no-deps']);
}
cpSync(join(work, 'user', 'libraries'), libraries, { recursive: true });

// Not needed to compile or upload, and large: indexes are fetched again when the user installs something.
for (const f of readdirSync(data)) if (/^library_index|\.tmp$|^tmp$/.test(f)) rmSync(join(data, f), { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });

// ───────────────────────── 3. manifest ─────────────────────────
const size = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).reduce((n, e) => (e.isFile() ? n + statSync(join(e.parentPath, e.name)).size : n), 0);
const manifest = {
  platform: key,
  arduinoCli: TOOLCHAIN_PINS.arduinoCli,
  platforms: Object.fromEntries(platforms.map(([id, p]) => [id, p.version])),
  libraries: Object.fromEntries([...libs].sort(([a], [b]) => a.localeCompare(b))),
  megabytes: Math.round((size(data) + size(libraries) + statSync(cli).size) / 1e6),
};
writeFileSync(join(resources, 'toolchain.json'), JSON.stringify(manifest, null, 2) + '\n');
say(`done: ${JSON.stringify(manifest)}`);
if (!existsSync(join(data, 'packages'))) die('the data directory has no packages folder');
