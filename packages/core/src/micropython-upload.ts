/**
 * Pure helpers for putting a program on a MicroPython board over its serial "raw REPL":
 * the control characters, and the small Python snippets that write `main.py` in chunks.
 */
export const REPL = {
  INTERRUPT: '\x03', // Ctrl-C: stop the running program
  RAW: '\x01', // Ctrl-A: enter raw REPL
  NORMAL: '\x02', // Ctrl-B: leave raw REPL
  EXECUTE: '\x04', // Ctrl-D: run what was sent (raw REPL) / soft reset (normal REPL)
  RAW_BANNER: 'raw REPL; CTRL-B to exit',
} as const;

/** A Python bytes literal for arbitrary text (UTF-8), safe to send through the REPL. */
export function pyBytesLiteral(text: string): string {
  let out = "b'";
  // TextEncoder exists in Node, Electron and browsers; core has no DOM lib, so type it locally.
  const { TextEncoder: Encoder } = globalThis as unknown as { TextEncoder: new () => { encode(s: string): Uint8Array } };
  for (const byte of new Encoder().encode(text)) {
    if (byte === 0x5c) out += '\\\\';
    else if (byte === 0x27) out += "\\'";
    else if (byte === 0x0a) out += '\\n';
    else if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    else out += `\\x${byte.toString(16).padStart(2, '0')}`;
  }
  return `${out}'`;
}

/** The snippets to execute, in order, to store `code` as `fileName` on the board. */
export function writeFileCommands(code: string, fileName = 'main.py', chunkChars = 256): string[] {
  const commands = [`f=open(${JSON.stringify(fileName)},'wb')`];
  for (let i = 0; i < code.length; i += chunkChars) commands.push(`f.write(${pyBytesLiteral(code.slice(i, i + chunkChars))})`);
  commands.push('f.close()');
  return commands;
}

/**
 * Split the board's answer to one raw-REPL execution: "OK<stdout>\x04<stderr>\x04>".
 * Returns undefined while the answer is still incomplete.
 */
export function parseRawReply(buffer: string): { ok: boolean; stdout: string; stderr: string } | undefined {
  const start = buffer.indexOf('OK');
  if (start < 0) return undefined;
  const first = buffer.indexOf(REPL.EXECUTE, start + 2);
  const second = first < 0 ? -1 : buffer.indexOf(REPL.EXECUTE, first + 1);
  if (second < 0) return undefined;
  const stderr = buffer.slice(first + 1, second);
  return { ok: stderr.trim() === '', stdout: buffer.slice(start + 2, first), stderr };
}
