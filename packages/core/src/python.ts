/**
 * The Python environment (Phase 3c): general-purpose Python 3 that runs on this computer
 * (CPython compiled to WebAssembly, Pyodide), with a `tariro` module that drives the board over
 * the same USB link as live mode. This file holds what the worker and the app share: the
 * `tariro` module's source and the messages between them. Pure TypeScript, tested in Node.
 */
import type { LiveOp } from './ipc.js';

/** Worker → app. */
export type PythonWorkerMessage =
  | { kind: 'ready'; version: string }
  | { kind: 'output'; stream: 'stdout' | 'stderr'; text: string }
  /** A pin operation (the app connects to the board first if needed). */
  | { kind: 'io'; id: number; op: LiveOp }
  | { kind: 'done'; result: PythonResult };

/** App → worker. */
export type PythonHostMessage =
  /** Start loading the interpreter (before the first Run, so it is ready sooner). */
  | { kind: 'load' }
  | { kind: 'run'; code: string }
  /** Ends waits and board calls at once; a program busy computing is ended by the app instead. */
  | { kind: 'stop' }
  | { kind: 'reply'; id: number; value?: number | null; error?: string };

/** Error text the app sends back when the learner pressed Stop; the `tariro` module turns it into StopProgram. */
export const PYTHON_STOP = 'TARIRO_STOP';

/** The `tariro` module, installed into the interpreter before a program runs. */
export const TARIRO_PYTHON_MODULE = String.raw`"""
Tariro: drive your board from Python on this computer.

    from tariro import board
    board.digital_write(13, True)    # pin 13 on (an LED)
    board.analog_read("A0")          # 0-1023
    board.servo_write(9, 90)         # servo on pin 9 to 90 degrees

The board is reached over USB with the same link as live mode, so it needs the live firmware
(Tariro Studio offers to install it). The first board command connects to it.
"""
import json as _json
import time as _time
from pyodide.ffi import run_sync as _run_sync
import _tariro_host as _host

__all__ = ["board", "wait", "BoardError"]

_STOP = "${PYTHON_STOP}"


class BoardError(Exception):
    """The board could not do what was asked: not connected, not a pin, and so on."""


class StopProgram(BaseException):
    """Raised when Stop is pressed. A BaseException, so "except Exception" does not catch it."""


def _await(promise):
    try:
        return _run_sync(promise)
    except Exception as e:  # a rejected JavaScript promise
        message = str(e)
        if _STOP in message:
            raise StopProgram("Stopped") from None
        # "Error: ..." -> "..."
        raise BoardError(message.split(": ", 1)[1] if message.startswith("Error: ") else message) from None


def wait(seconds):
    """Pause the program. Stop works during a wait."""
    if not isinstance(seconds, (int, float)) or seconds < 0:
        raise ValueError("wait() needs a number of seconds, 0 or more")
    _await(_host.sleep(float(seconds) * 1000))


def _whole(value, what):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value):
        raise BoardError(f"{what} must be a whole number, not {value!r}")
    return int(value)


class Board:
    """The board on the USB port chosen in the toolbar."""

    def _io(self, op, **args):
        return _await(_host.request(_json.dumps(dict(op=op, **args))))

    def _pin(self, pin):
        # "A0".."A15" are the analog pins, which also work as digital pins.
        if isinstance(pin, str) and pin[:1] in ("A", "a") and pin[1:].isdigit():
            n = self._io("analogPin", channel=int(pin[1:]))
            if n is None:
                raise BoardError(f"{pin} is not a pin on this board")
            return int(n)
        n = _whole(pin, "A pin")
        if n < 0:
            raise BoardError("A pin number cannot be negative")
        return n

    def digital_write(self, pin, value):
        """Set a pin on (True, 1) or off (False, 0)."""
        self._io("digitalWrite", pin=self._pin(pin), on=bool(value))

    def digital_read(self, pin, pullup=False):
        """True when the pin is high. pullup=True for a button wired to GND."""
        return self._io("digitalRead", pin=self._pin(pin), pullup=bool(pullup)) == 1

    def analog_read(self, pin):
        """0-1023 from an analog pin: "A0" or the channel number 0."""
        if isinstance(pin, str):
            if not (pin[:1] in ("A", "a") and pin[1:].isdigit()):
                raise BoardError(f"{pin!r} is not an analog pin; use a name like 'A0'")
            pin = int(pin[1:])
        channel = _whole(pin, "An analog channel")
        if not 0 <= channel <= 15:
            raise BoardError("An analog channel is 0-15")
        return int(self._io("analogRead", channel=channel))

    def pwm_write(self, pin, value):
        """PWM duty 0-255 on a PWM pin (LED brightness, motor speed)."""
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise BoardError("pwm_write() needs a number 0-255")
        self._io("analogWrite", pin=self._pin(pin), value=int(min(max(value, 0), 255)))

    def servo_write(self, pin, angle):
        """Turn a servo to 0-180 degrees."""
        if not isinstance(angle, (int, float)) or isinstance(angle, bool):
            raise BoardError("servo_write() needs an angle 0-180")
        self._io("servoWrite", pin=self._pin(pin), angle=int(min(max(angle, 0), 180)))


board = Board()

# time.sleep also waits without freezing the app, and can be stopped.
_time.sleep = wait
`;

/**
 * The line in the learner's program where a Python traceback ended (frames in "<exec>", the
 * file name Pyodide gives to code it runs). Undefined when the error came from elsewhere.
 */
export function pythonErrorLine(traceback: string): number | undefined {
  let line: number | undefined;
  for (const m of traceback.matchAll(/File "<exec>", line (\d+)/g)) line = Number(m[1]);
  return line;
}

/**
 * A Python traceback trimmed for learners: Pyodide's own frames (inside its runtime and the
 * `tariro` module) are dropped, the learner's frames and the final error line are kept.
 */
export function tidyTraceback(traceback: string): string {
  const lines = traceback.trimEnd().split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const frame = /^\s+File "([^"]+)"/.exec(l);
    if (frame) {
      const own = frame[1] === '<exec>';
      // A frame is its "File" line plus the indented source line(s) after it.
      const body: string[] = [l];
      while (i + 1 < lines.length && /^\s{4,}/.test(lines[i + 1]!) && !/^\s+File "/.test(lines[i + 1]!)) body.push(lines[++i]!);
      if (own) out.push(...body);
      continue;
    }
    out.push(l);
  }
  return out.join('\n');
}

/** Starter program for a new Python file. */
export const PYTHON_STARTER = `# Python on this computer. Press Run to start it.
# The tariro module drives the board over USB (it needs the live firmware).
from tariro import board, wait

print("Hello from Python!")
for n in range(1, 4):
    print(n, "squared is", n * n)

# Uncomment to blink the LED on pin 13 five times:
# for _ in range(5):
#     board.digital_write(13, True)
#     wait(0.5)
#     board.digital_write(13, False)
#     wait(0.5)
`;

/** The parts of the Pyodide API the runner uses (so core does not depend on Pyodide's types). */
export interface PyodideLike {
  version: string;
  setStdout(o: { batched: (text: string) => void }): void;
  setStderr(o: { batched: (text: string) => void }): void;
  setStdin(o: { error: boolean }): void;
  registerJsModule(name: string, module: object): void;
  runPython(code: string): unknown;
  runPythonAsync(code: string, options?: { globals?: unknown; filename?: string }): Promise<unknown>;
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void };
  globals: { get(name: string): unknown };
}

/** What a running Python program needs from the app. */
export interface PythonHost {
  /** A pin operation on the board (the app connects first if needed). Rejects with a message on failure. */
  request(op: LiveOp): Promise<number | null>;
  /** Resolves after `ms`; rejects with PYTHON_STOP when the learner presses Stop. */
  sleep(ms: number): Promise<void>;
  output(stream: 'stdout' | 'stderr', text: string): void;
  /** True once Stop was pressed (to tell a stop from a KeyboardInterrupt the program raised itself). */
  stopping(): boolean;
}

export interface PythonResult {
  outcome: 'finished' | 'stopped' | 'error';
  message: string;
  line?: number;
  /** For errors: the traceback without Pyodide's own frames. */
  traceback?: string;
}

/** The host of the program each interpreter is running now (the bridge is installed once). */
const hosts = new WeakMap<object, { current: PythonHost }>();

/** Install the `tariro` module and the host bridge into an interpreter (once). */
function preparePython(py: PyodideLike, slot: { current: PythonHost }): void {
  const host = () => slot.current;
  py.setStdout({ batched: (t) => host().output('stdout', t) });
  py.setStderr({ batched: (t) => host().output('stderr', t) });
  // input() has nothing to read from yet; make it fail clearly instead of hanging.
  py.setStdin({ error: true });
  py.registerJsModule('_tariro_host', {
    request: (json: string) => host().request(JSON.parse(json) as LiveOp),
    sleep: (ms: number) => host().sleep(ms),
  });
  py.FS.mkdirTree('/tariro');
  py.FS.writeFile('/tariro/tariro.py', TARIRO_PYTHON_MODULE);
  py.runPython('import sys\nsys.path.insert(0, "/tariro")\nimport tariro');
}

/** Run a learner's program with fresh globals. Never throws: errors come back as a result. */
export async function runPython(py: PyodideLike, code: string, host: PythonHost): Promise<PythonResult> {
  let slot = hosts.get(py);
  if (!slot) {
    slot = { current: host };
    preparePython(py, slot);
    hosts.set(py, slot);
  }
  slot.current = host;
  const dict = py.globals.get('dict') as () => { destroy?(): void };
  const globals = dict();
  try {
    await py.runPythonAsync(code, { globals, filename: '<exec>' });
    return { outcome: 'finished', message: 'The program finished.' };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (host.stopping() && /StopProgram|KeyboardInterrupt/.test(text)) return { outcome: 'stopped', message: 'Stopped.' };
    const tidy = tidyTraceback(text);
    const line = pythonErrorLine(text);
    return { outcome: 'error', message: tidy.split('\n').at(-1) ?? tidy, traceback: tidy, ...(line !== undefined ? { line } : {}) };
  } finally {
    globals.destroy?.();
  }
}
