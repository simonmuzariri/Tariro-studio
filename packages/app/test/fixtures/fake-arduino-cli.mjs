#!/usr/bin/env node
// Stand-in for arduino-cli in tests. FAKE_CLI_MODE selects the scenario:
//   ok (default) · compile-error · upload-fail · slow (upload hangs until killed)
// Output mimics arduino-cli 1.3 / avr-gcc / avrdude closely enough for the parsers.
import { writeFileSync, appendFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a, i, all) => a !== '--config-file' && all[i - 1] !== '--config-file');
const mode = process.env.FAKE_CLI_MODE ?? 'ok';
const record = process.env.FAKE_CLI_RECORD;
if (record) appendFileSync(record, JSON.stringify(args) + '\n');
const out = (s) => process.stdout.write(s + '\n');
const err = (s) => process.stderr.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [cmd] = args;
if (cmd === 'version') {
  out(JSON.stringify({ Application: 'arduino-cli', VersionString: '1.3.1-fake' }));
} else if (cmd === 'core') {
  out(JSON.stringify({ platforms: [{ id: 'arduino:avr', installed_version: '1.8.7' }] }));
} else if (cmd === 'lib' && args[1] === 'list') {
  out(JSON.stringify({ installed_libraries: [{ library: { name: 'Servo', version: '1.3.0' } }] }));
} else if (cmd === 'lib' && args[1] === 'install') {
  if (mode === 'lib-fail') {
    err('Error installing: network unreachable');
    process.exit(1);
  }
  out(`Installed ${args[2]}`);
} else if (cmd === 'compile') {
  const sketchDir = args.at(-1);
  if (mode === 'compile-error') {
    err(`${sketchDir}/sketch.ino: In function 'void loop()':`);
    err(`${sketchDir}/sketch.ino:12:3: error: 'foo' was not declared in this scope`);
    err('exit status 1');
    process.exit(1);
  }
  out('Sketch uses 924 bytes (2%) of program storage space. Maximum is 32256 bytes.');
  out('Global variables use 9 bytes (0%) of dynamic memory, leaving 2039 bytes for local variables. Maximum is 2048 bytes.');
  const build = args[args.indexOf('--build-path') + 1];
  if (build) writeFileSync(`${build}/sketch.ino.hex`, ':00000001FF\n');
} else if (cmd === 'upload') {
  if (mode === 'upload-fail') {
    err('avrdude: stk500_recv(): programmer is not responding');
    err('avrdude: stk500_getsync() attempt 10 of 10: not in sync: resp=0x00');
    process.exit(1);
  }
  if (mode === 'slow') {
    err('Writing | ##########                                         | 20% 0.40s');
    await sleep(60_000);
  }
  for (const pct of [0, 50, 100]) {
    err(`Writing | ${'#'.repeat(pct / 2).padEnd(50)} | ${pct}% 0.${pct}s`);
    await sleep(20);
  }
  err('avrdude done.  Thank you.');
} else {
  err(`fake-arduino-cli: unsupported command ${cmd}`);
  process.exit(2);
}
