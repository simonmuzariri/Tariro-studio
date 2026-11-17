import { useCallback, useEffect, useState } from 'react';

export type ThemeName = 'dark' | 'light';
const KEY = 'tariro.theme';

const stored = (): ThemeName => {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

// Set before the first paint, so the window never flashes the other theme.
document.documentElement.dataset['theme'] = stored();

/** The app theme. Dark is the default; the choice is remembered on this computer. */
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
