import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { generateArduino, generateMicroPython, getBoard, parseRawReply, pyBytesLiteral, writeFileCommands, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, EXAMPLES } from '../src/index.js';
import { block, forever, n, program, set, t, v, workspace } from '../src/build.js';

const registry = createRegistry();
const esp = getBoard('malkon-esp32s3');
const gen = (ws: WorkspaceJson) => generateMicroPython(ws, esp, registry);
const example = (name: string) => EXAMPLES.find((e) => e.name === name)!.workspace;

/** Programs whose every block has a MicroPython emitter. */
const PROGRAMS = ['blink', 'night-light', 'wifi-hello'];

const python = spawnSync('python3', ['--version']).status === 0;

describe('MicroPython generator', () => {
  it.each(PROGRAMS)('generates the expected program for %s', async (name) => {
    const r = gen(example(name));
    expect(r.warnings).toEqual([]);
    await expect(r.code).toMatchFileSnapshot(`./golden/__snapshots__/${name}.malkon-esp32s3.py`);
  });

  it.skipIf(!python).each(PROGRAMS)('%s is valid Python syntax', (name) => {
    const r = spawnSync('python3', ['-I', '-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: gen(example(name)).code, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('runs blocks before forever once and loops the rest', () => {
    const r = gen(workspace([program(block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: t('hi') } }), forever(block('io_digital_write', { fields: { PIN: '13', STATE: 'HIGH' } })))]));
    expect(r.code).toContain('pin13_out = Pin(13, Pin.OUT)');
    expect(r.code).toMatch(/print\("hi"\)\n\nwhile True:\n {4}pin13_out\.value\(1\)/);
  });

  it('keeps an empty forever loop from spinning without a pause', () => {
    expect(gen(workspace([program(forever())])).code).toContain('while True:\n    time.sleep_ms(10)');
  });

  it('declares program variables as global inside functions that change them', () => {
    const def = block('procedures_defnoreturn', {
      fields: { NAME: 'count up' },
      extraState: { params: [{ name: 'by', id: 'by' }] },
      do: { STACK: [block('math_change', { fields: { VAR: { id: 'total' } }, inputs: { DELTA: v('by') } })] },
    });
    const r = gen(workspace([program(set('total', n(0)), block('procedures_callnoreturn', { extraState: { name: 'count up', params: ['by'] }, inputs: { ARG0: n(2) } })), def], [{ id: 'total', name: 'total' }, { id: 'by', name: 'by' }]));
    expect(r.code).toContain('def countUp(by):\n    global total\n    total += by');
    expect(r.code).toContain('total = 0');
    expect(r.code).toContain('countUp(2)');
  });

  it('renames learner variables that would shadow Python names', () => {
    const r = gen(workspace([program(set('a', n(1)))], [{ id: 'a', name: 'print' }]));
    expect(r.code).not.toMatch(/^print = /m);
    expect(r.code).toMatch(/^print2 = 1$/m);
  });

  it('warns about blocks that have no MicroPython version yet, and about AVR boards', () => {
    const r = gen(workspace([program(block('lcd_clear'))]));
    expect(r.warnings.map((w) => w.message)).toContain('This block is not available in MicroPython yet.');
    const avr = generateMicroPython(example('blink'), getBoard('tariro'), registry);
    expect(avr.warnings.some((w) => /cannot run MicroPython/.test(w.message))).toBe(true);
  });

  it('leaves the Arduino output of the same program unchanged', () => {
    expect(generateArduino(example('blink'), esp, registry).code).toContain('digitalWrite(13, HIGH);');
  });
});

describe('MicroPython upload helpers', () => {
  it('encodes any text as a Python bytes literal', () => {
    expect(pyBytesLiteral("a'b\\c\n")).toBe("b'a\\'b\\\\c\\n'");
    expect(pyBytesLiteral('é°')).toBe("b'\\xc3\\xa9\\xc2\\xb0'");
  });

  it.skipIf(!python)('round-trips a program through the generated write commands', () => {
    const code = gen(example('wifi-hello')).code + '# naïve “quotes” \\ and \'single\'\n';
    const script = ['import io', 'buf=io.BytesIO()', 'class F:\n    def write(self,b): buf.write(b)\n    def close(self): pass', 'def open(name,mode): return F()', ...writeFileCommands(code, 'main.py', 64), 'import sys', 'sys.stdout.buffer.write(buf.getvalue())'].join('\n');
    const r = spawnSync('python3', ['-I', '-c', script], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(code);
  });

  it('parses raw REPL replies', () => {
    expect(parseRawReply('OK')).toBeUndefined();
    expect(parseRawReply('OKhello\r\n\x04\x04>')).toEqual({ ok: true, stdout: 'hello\r\n', stderr: '' });
    expect(parseRawReply('OK\x04Traceback: boom\r\n\x04>')?.ok).toBe(false);
  });
});
