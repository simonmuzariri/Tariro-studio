import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, 'fake-arduino-cli.mjs');

/** An executable path for the fake CLI (a .cmd shim on Windows, the script itself elsewhere). */
export function fakeCliPath(): string {
  if (process.platform !== 'win32') {
    chmodSync(script, 0o755);
    return script;
  }
  const dir = mkdtempSync(join(tmpdir(), 'fake-cli-'));
  const shim = join(dir, 'arduino-cli.cmd');
  writeFileSync(shim, `@"${process.execPath}" "${script}" %*\r\n`);
  return shim;
}
