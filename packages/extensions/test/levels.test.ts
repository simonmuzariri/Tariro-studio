import { describe, expect, it } from 'vitest';
import { EXPERIENCE_LEVELS, getBoard, type ExperienceLevel, type ToolboxCategorySpec } from '@tariro-studio/core';
import { createRegistry } from '../src/index.js';

const registry = createRegistry();
const blockTypes = (cats: ToolboxCategorySpec[]) => cats.flatMap((c) => c.contents.flatMap((i) => (i.kind === 'block' ? [i.type] : [])));
const at = (level: ExperienceLevel, board = 'tariro') => registry.toolboxFor(getBoard(board), [], level);

describe('experience levels (A7)', () => {
  it('Advanced is the full toolbox, the default', () => {
    expect(blockTypes(at('advanced'))).toEqual(blockTypes(registry.toolboxFor(getBoard('tariro'))));
  });

  it('each level offers everything the level below offers, and more', () => {
    for (const board of ['tariro', 'arduino-uno', 'malkon-esp32s3']) {
      const [b, i, a] = EXPERIENCE_LEVELS.map((l) => new Set(blockTypes(at(l, board))));
      for (const t of b!) expect(i!.has(t), `${t} on ${board}`).toBe(true);
      for (const t of i!) expect(a!.has(t), `${t} on ${board}`).toBe(true);
      expect(i!.size).toBeGreaterThan(b!.size);
      expect(a!.size).toBeGreaterThan(i!.size);
    }
  });

  it('Beginner keeps the first-program blocks and hides tuning blocks', () => {
    const beginner = new Set(blockTypes(at('beginner')));
    for (const t of ['tariro_on_start', 'tariro_forever', 'controls_if', 'tariro_wait_seconds', 'basic_led', 'sensor_button_pressed', 'tariro_motor_run', 'act_servo'])
      expect(beginner.has(t), t).toBe(true);
    for (const t of ['basic_pid', 'enc_config', 'act_stepper_goto', 'serial_read_line', 'tariro_millis']) expect(beginner.has(t), t).toBe(false);
    const ids = at('beginner').map((c) => c.id);
    expect(ids).not.toContain('text');
    expect(ids).not.toContain('functions');
    expect(ids).not.toContain('serial');
    expect(ids).toContain('variables');
  });

  it('leaves no empty labels, empty categories or stray separators', () => {
    for (const level of EXPERIENCE_LEVELS)
      for (const cat of at(level)) {
        if (cat.custom) continue;
        expect(cat.contents.some((i) => i.kind === 'block'), `${cat.id} at ${level}`).toBe(true);
        cat.contents.forEach((item, n) => {
          if (item.kind === 'label') expect(cat.contents[n + 1]?.kind, `${cat.id}: "${item.text}" at ${level}`).toBe('block');
          if (item.kind === 'sep') expect(n > 0 && n < cat.contents.length - 1 && cat.contents[n - 1]?.kind !== 'sep').toBe(true);
        });
      }
  });
});
