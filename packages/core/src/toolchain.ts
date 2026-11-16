/**
 * Pure helpers for the Arduino toolchain: parsing arduino-cli / gcc / avrdude / esptool output,
 * mapping compiler diagnostics back to blocks, and recognising boards by USB id.
 */
import { BOARDS } from './boards.js';
import type { BuildSizes, Diagnostic } from './ipc.js';
import type { GeneratedProgram } from './types.js';

const DIAG_RE = /^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.*)$/;

/** gcc-style diagnostics that refer to the given sketch file (other files are libraries/cores). */
export function parseDiagnostics(output: string, sketchFileName = 'sketch.ino'): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const m = DIAG_RE.exec(raw.trim());
    if (!m) continue;
    const [, file, line, col, sev, message] = m;
    const base = file!.split(/[\\/]/).pop() ?? file!;
    if (base !== sketchFileName) continue;
    const d: Diagnostic = {
      file: base,
      line: Number(line),
      severity: sev === 'warning' ? 'warning' : 'error',
      message: message!.trim(),
    };
    if (col) d.column = Number(col);
    const key = `${d.line}:${d.column ?? ''}:${d.severity}:${d.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

/** "Sketch uses 924 bytes (2%) of program storage space. Maximum is 32256 bytes." etc. */
export function parseSizes(output: string): BuildSizes | undefined {
  const flash = /Sketch uses (\d+) bytes.*?Maximum is (\d+) bytes/s.exec(output);
  if (!flash) return undefined;
  const sizes: BuildSizes = { flash: Number(flash[1]), flashMax: Number(flash[2]) };
  const ram = /Global variables use (\d+) bytes.*?Maximum is (\d+) bytes/s.exec(output);
  if (ram) {
    sizes.ram = Number(ram[1]);
    sizes.ramMax = Number(ram[2]);
  }
  return sizes;
}

/** Upload progress from avrdude ("| 100% 1.2s") or esptool ("Writing at 0x… (45 %)"). */
export function parseUploadPercent(line: string): number | undefined {
  const m = /\|\s*(\d{1,3})%/.exec(line) ?? /\((\d{1,3})\s?%\)/.exec(line);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : undefined;
}

/** The block whose generated code contains `line` (nearest marked statement at or above it). */
export function blockForLine(sourceMap: GeneratedProgram['sourceMap'], line: number): string | undefined {
  let best: { line: number; blockId: string } | undefined;
  for (const m of sourceMap) if (m.line <= line && (!best || m.line >= best.line)) best = m;
  return best?.blockId;
}

/** Recognise a board from a USB vendor/product id (first matching board wins). */
export function suggestBoard(vid?: string, pid?: string): string | undefined {
  if (!vid || !pid) return undefined;
  const v = vid.toLowerCase();
  const p = pid.toLowerCase();
  return BOARDS.find((b) => b.usb.some((u) => u.vid === v && u.pid === p))?.id;
}

/** Turn a raw upload/compile failure into a sentence a learner can act on. */
export function explainFailure(output: string, phase: 'compiling' | 'uploading'): string {
  const o = output.toLowerCase();
  if (phase === 'uploading') {
    if (o.includes('permission denied') || o.includes('eacces'))
      return 'The computer does not allow access to the USB port. On Linux, add your user to the "dialout" group and log in again.';
    if (o.includes('not in sync') || o.includes('stk500_recv') || o.includes('stk500_getsync'))
      return 'The board did not answer. Check that the right board and port are selected, then try again.';
    if (o.includes('no such file') || o.includes('could not open port') || o.includes('cannot open'))
      return 'The selected port is not available. Reconnect the USB cable and choose the port again.';
    if (o.includes('busy') || o.includes('resource temporarily unavailable'))
      return 'Another program is using the port. Close it (for example another Serial Monitor) and try again.';
    return 'Uploading failed. See the Output tab for details.';
  }
  if (o.includes('no such file or directory') && o.includes('.h'))
    return 'A library this program needs is not installed.';
  if (o.includes('platform not installed') || o.includes('unknown fqbn') || o.includes('invalid fqbn'))
    return 'Support for this board is not installed in the Arduino toolchain.';
  if (o.includes('text section exceeds') || o.includes('sketch too big'))
    return 'The program is too big for this board. Try removing some blocks.';
  return 'The program could not be compiled. See the Problems and Output tabs for details.';
}
