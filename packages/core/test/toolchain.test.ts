import { describe, expect, it } from 'vitest';
import { blockForLine, explainFailure, parseDiagnostics, parseSizes, parseUploadPercent, suggestBoard } from '../src/toolchain.js';

describe('toolchain output parsing', () => {
  it('keeps only diagnostics from the sketch, deduplicated', () => {
    const out = [
      '/tmp/x/sketch/sketch.ino:5:10: warning: unused variable \'a\' [-Wunused-variable]',
      'C:\\Users\\k\\sketch\\sketch.ino:12:3: error: expected \';\' before \'}\' token',
      '/home/u/.arduino15/packages/arduino/hardware/avr/1.8.7/cores/arduino/main.cpp:43:1: error: boom',
      '/tmp/x/sketch/sketch.ino:12:3: error: expected \';\' before \'}\' token',
      '/tmp/x/sketch/sketch.ino:2:10: fatal error: Servo.h: No such file or directory',
    ].join('\n');
    expect(parseDiagnostics(out)).toEqual([
      { file: 'sketch.ino', line: 5, column: 10, severity: 'warning', message: "unused variable 'a' [-Wunused-variable]" },
      { file: 'sketch.ino', line: 12, column: 3, severity: 'error', message: "expected ';' before '}' token" },
      { file: 'sketch.ino', line: 2, column: 10, severity: 'error', message: 'Servo.h: No such file or directory' },
    ]);
  });

  it('parses flash and RAM use', () => {
    expect(
      parseSizes(
        'Sketch uses 1444 bytes (4%) of program storage space. Maximum is 32256 bytes.\nGlobal variables use 9 bytes (0%) of dynamic memory, leaving 2039 bytes for local variables. Maximum is 2048 bytes.',
      ),
    ).toEqual({ flash: 1444, flashMax: 32256, ram: 9, ramMax: 2048 });
    expect(parseSizes('nothing')).toBeUndefined();
  });

  it('reads avrdude and esptool progress', () => {
    expect(parseUploadPercent('Writing | ################################################## | 100% 0.42s')).toBe(100);
    expect(parseUploadPercent('Writing at 0x00010000... (45 %)')).toBe(45);
    expect(parseUploadPercent('avrdude done.  Thank you.')).toBeUndefined();
  });

  it('maps a code line to the nearest block at or above it', () => {
    const map = [
      { line: 10, blockId: 'a' },
      { line: 12, blockId: 'b' },
      { line: 20, blockId: 'loop' },
    ];
    expect(blockForLine(map, 12)).toBe('b');
    expect(blockForLine(map, 15)).toBe('b');
    expect(blockForLine(map, 9)).toBeUndefined();
  });

  it('recognises boards by USB id, preferring Tariro for CH340', () => {
    expect(suggestBoard('1A86', '7523')).toBe('tariro');
    expect(suggestBoard('2341', '0043')).toBe('arduino-uno');
    expect(suggestBoard('2341', '0042')).toBe('arduino-mega');
    expect(suggestBoard('dead', 'beef')).toBeUndefined();
  });

  it('explains common failures in plain language', () => {
    expect(explainFailure("avrdude: ser_open(): can't open device \"/dev/ttyUSB0\": Permission denied", 'uploading')).toMatch(/dialout/);
    expect(explainFailure('stk500_getsync() attempt 10 of 10: not in sync', 'uploading')).toMatch(/did not answer/);
    expect(explainFailure('fatal error: Servo.h: No such file or directory', 'compiling')).toMatch(/library/);
  });
});
