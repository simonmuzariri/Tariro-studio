import { spawn, type ChildProcess } from 'node:child_process';

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  cancelled: boolean;
}

/**
 * Run a command, streaming each output line, with cancellation that also stops grandchildren
 * (arduino-cli → avr-gcc / avrdude): a process group on POSIX, `taskkill /T` on Windows.
 */
export class CancellableProcess {
  private child: ChildProcess | undefined;
  private cancelled = false;

  run(cmd: string, args: string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void, env?: NodeJS.ProcessEnv): Promise<RunResult> {
    return new Promise((resolve) => {
      let output = '';
      const child = spawn(cmd, args, {
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      const pump = (stream: 'stdout' | 'stderr') => {
        let pending = '';
        return (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          output += text;
          pending += text;
          // avrdude/esptool redraw progress with \r; treat it as a line break.
          const parts = pending.split(/\r\n|\n|\r/);
          pending = parts.pop() ?? '';
          for (const p of parts) if (p.length) onLine(p, stream);
        };
      };
      child.stdout?.on('data', pump('stdout'));
      child.stderr?.on('data', pump('stderr'));
      child.on('error', (err) => {
        output += `\n${err.message}`;
        onLine(err.message, 'stderr');
      });
      child.on('close', (code, signal) => {
        this.child = undefined;
        resolve({ code, signal, output, cancelled: this.cancelled });
      });
    });
  }

  cancel(): boolean {
    const child = this.child;
    if (!child?.pid) return false;
    this.cancelled = true;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    return true;
  }
}
