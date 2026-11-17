import { useCallback, useEffect, useState } from 'react';
import { EXPERIENCE_LEVELS, type ExperienceLevel } from '@tariro-studio/core';

export type ThemeName = 'dark' | 'light';
const KEY = 'tariro.theme';

const stored = (): ThemeName => {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

// Set before the first paint, so the window never flashes the other theme.
document.documentElement.dataset['theme'] = stored();

/** The app theme. Light is the default; the choice is remembered on this computer. */
export function useTheme(): [ThemeName, () => void] {
  const [theme, setTheme] = useState<ThemeName>(stored);
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: the choice lasts for this session only */
    }
  }, [theme]);
  return [theme, useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])];
}

/** A number kept in localStorage (panel sizes). */
export function useStoredNumber(key: string, initial: number): [number, (v: number) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return Number.isFinite(v) && v > 0 ? v : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: number) => {
      setValue(v);
      try {
        localStorage.setItem(key, String(Math.round(v)));
      } catch {
        /* not remembered */
      }
    },
    [key],
  );
  return [value, set];
}

const LEVEL_KEY = 'tariro.level';

/**
 * The learner's experience level (EXPANSION_PLAN A7), remembered on this computer. Advanced (every
 * block) is the default, so nothing an existing user had in the toolbox disappears.
 */
export function useLevel(): [ExperienceLevel, (l: ExperienceLevel) => void] {
  const [level, setLevel] = useState<ExperienceLevel>(() => {
    try {
      const v = localStorage.getItem(LEVEL_KEY);
      return (EXPERIENCE_LEVELS as readonly string[]).includes(v ?? '') ? (v as ExperienceLevel) : 'advanced';
    } catch {
      return 'advanced';
    }
  });
  const set = useCallback((l: ExperienceLevel) => {
    setLevel(l);
    try {
      localStorage.setItem(LEVEL_KEY, l);
    } catch {
      /* not remembered */
    }
  }, []);
  return [level, set];
}

/** One of a fixed set of choices, remembered on this computer (the coding mode). */
export function useStoredChoice<T extends string>(key: string, choices: readonly T[], initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key);
      return (choices as readonly string[]).includes(v ?? '') ? (v as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* not remembered */
      }
    },
    [key],
  );
  return [value, set];
}
