import { describe, expect, it } from 'vitest';
import { getBoard } from '@tariro-studio/core';
import { createRegistry } from '@tariro-studio/extensions';
import { parsePlot, plotRange } from '../src/renderer/src/hardware/plot.js';
import { LOCALES, setLocale, t } from '../src/renderer/src/i18n/index.js';
import { en } from '../src/renderer/src/i18n/en.js';

describe('serial plotter parsing', () => {
  it('plots unlabelled values by position and skips ordinary messages', () => {
    const d = parsePlot('Night light ready\n10, 20\n11,21\n12 22\n');
    expect(d.series).toEqual(['value 1', 'value 2']);
    expect(d.rows).toEqual([[10, 20], [11, 21], [12, 22]]);
  });

  it('reads labelled values in either form and keeps series aligned', () => {
    const d = parsePlot('temp:25.5, light=60\nlight: 61\ntemp = -3e1\n');
    expect(d.series).toEqual(['temp', 'light']);
    expect(d.rows).toEqual([[25.5, 60], [undefined, 61], [-30]]);
  });

  it('ignores the unfinished last line and keeps only the newest rows', () => {
    expect(parsePlot('1\n2\n3').rows).toEqual([[1], [2]]);
    const many = Array.from({ length: 500 }, (_, i) => String(i)).join('\n') + '\n';
    const d = parsePlot(many, 300);
    expect(d.rows).toHaveLength(300);
    expect(d.rows.at(-1)).toEqual([499]);
  });

  it('gives a usable range for empty and flat data', () => {
    expect(plotRange(parsePlot(''))).toEqual({ min: 0, max: 1 });
    expect(plotRange(parsePlot('5\n5\n'))).toEqual({ min: 4, max: 6 });
    expect(plotRange(parsePlot('-2, 8\n'))).toEqual({ min: -2, max: 8 });
  });
});

describe('translations', () => {
  it('fills placeholders and falls back to English', () => {
    expect(t('dock.problemsCount', { count: 3 })).toBe('Problems (3)');
    expect(setLocale('sn-ZW')).toBe('en'); // no Shona catalogue yet → English
    expect(t('file.save')).toBe('Save');
  });

  it('locales only use known keys and keep the same placeholders', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [code, locale] of Object.entries(LOCALES))
      for (const [key, text] of Object.entries(locale)) {
        expect(en, `${code}: unknown key ${key}`).toHaveProperty([key]);
        expect(holes(text), `${code}: ${key}`).toBe(holes(en[key as keyof typeof en]));
      }
  });
});

describe('code mode libraries', () => {
  it('takes the libraries of the enabled extensions for the board family', () => {
    const registry = createRegistry();
    const names = (board: string) => registry.librariesForExtensions(['actuators', 'displays'], getBoard(board)).map((l) => l.name);
    expect(names('tariro')).toContain('Servo');
    expect(names('tariro')).not.toContain('ESP32Servo');
    expect(names('malkon-esp32s3')).toContain('ESP32Servo');
    expect(names('malkon-esp32s3')).toContain('Adafruit SSD1306');
  });
});
