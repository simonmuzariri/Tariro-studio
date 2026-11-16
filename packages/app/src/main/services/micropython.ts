/**
 * Put a MicroPython program on a board: stop what is running, enter the raw REPL, write
 * `main.py` in chunks, then soft-reset so the new program starts. The board must already run
 * MicroPython firmware. No Electron imports; tested against a fake REPL port.
 */
import { parseRawReply, REPL, writeFileCommands, type BuildResult, type EventPayload } from '@tariro-studio/core';
import type { PortBackend, PortHandle } from './serial.js';

export interface MicroPythonEvents {
  log(e: EventPayload<'toolchain:log'>): void;
  progress(e: EventPayload<'toolchain:progress'>): void;
}

const fail = (message: string): BuildResult => ({ ok: false, phase: 'error', message, diagnostics: [] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MicroPythonService {
  private busy = false;

  constructor(
    private readonly backend: PortBackend,
    private readonly events: MicroPythonEvents,
    private readonly timing = { settleMs: 250, promptMs: 3000, commandMs: 5000 },
  ) {}

  async upload(portPath: string, code: string): Promise<BuildResult> {
    if (this.busy) return fail('Another upload is still running.');
    this.busy = true;
    let port: PortHandle | undefined;
    try {
      this.events.progress({ phase: 'uploading', percent: 0 });
      this.events.log({ line: `Connecting to MicroPython on ${portPath}…`, stream: 'info' });
      try {
        port = await this.backend.open(portPath, 115200);
      } catch (err) {
        return this.done(fail(`The port could not be opened: ${(err as Error).message}`));
      }
      let buffer = '';
      const decoder = new TextDecoder();
      port.on('data', (chunk) => {
        buffer += decoder.decode(chunk, { stream: true });
      });
      const write = (data: string) => new Promise<void>((resolve, reject) => port!.write(data, (e) => (e ? reject(e) : resolve())));
      const waitFor = async <T>(read: () => T | undefined, ms: number): Promise<T | undefined> => {
        const end = Date.now() + ms;
        for (;;) {
          const v = read();
          if (v !== undefined || Date.now() > end) return v;
          await sleep(10);
        }
      };

      // Stop the running program, then ask for the raw REPL.
      await write(`\r${REPL.INTERRUPT}${REPL.INTERRUPT}`);
      await sleep(this.timing.settleMs);
      buffer = '';
      await write(REPL.RAW);
      const banner = await waitFor(() => (buffer.includes(REPL.RAW_BANNER) ? true : undefined), this.timing.promptMs);
      if (!banner)
        return this.done(fail('MicroPython did not answer. Check the port, and that the board has MicroPython firmware installed.'));

      const commands = writeFileCommands(code);
      for (const [i, command] of commands.entries()) {
        buffer = '';
        await write(command + REPL.EXECUTE);
        const reply = await waitFor(() => parseRawReply(buffer), this.timing.commandMs);
        if (!reply) return this.done(fail('The board stopped answering while the program was being saved.'));
        if (!reply.ok) {
          this.events.log({ line: reply.stderr.trim(), stream: 'stderr' });
          return this.done(fail('The board reported an error while saving the program. See the Output tab.'));
        }
        this.events.progress({ phase: 'uploading', percent: Math.round(((i + 1) / commands.length) * 100) });
      }

      // Back to the normal REPL, then soft reset: MicroPython runs main.py.
      await write(REPL.NORMAL);
      await write(REPL.EXECUTE);
      await sleep(this.timing.settleMs);
      return this.done({ ok: true, phase: 'done', message: 'Saved to the board as main.py and started.', diagnostics: [] });
    } catch (err) {
      return this.done(fail(`Uploading failed: ${(err as Error).message}`));
    } finally {
      if (port?.isOpen) await new Promise<void>((resolve) => port!.close(() => resolve()));
      this.busy = false;
    }
  }

  private done(result: BuildResult): BuildResult {
    this.events.progress({ phase: result.phase });
    this.events.log({ line: result.message, stream: 'info' });
    return result;
  }
}
