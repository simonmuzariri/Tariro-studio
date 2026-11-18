import * as Blockly from 'blockly';

// Bright, friendly colours; each keeps at least 3:1 contrast with the bold white block text.
const COLOURS = {
  events: '#cc8400',
  loop: '#d4661a',
  logic: '#2f9a5a',
  math: '#2f9a5a',
  text: '#1d97b0',
  variable: '#e0457b',
  procedure: '#8a5ce0',
  list: '#a86a2e',
  pins: '#3576e0',
  serial: '#5a6bc4',
  // The brand red of the logo (white block text on it is 5.6:1).
  tariro: '#d6000f',
  basic: '#0f8f7a',
  sensors: '#2b8a9e',
  actuators: '#b5462e',
  displays: '#6d4fb3',
  communication: '#3b6fb6',
  iot: '#1e7d4f',
  // Creative Studio
  motion: '#2f6fd1',
  looks: '#7a4fd0',
  sound: '#b8429a',
  sensing: '#1f86a8',
  vision: '#8a3ec4',
  // Drone Studio: sky blue (white text 4:1).
  drone: '#1a7fc0',
} as const;

/** Darken a #rrggbb colour by `f` (0–1) for block borders. */
const darken = (c: string, f = 0.25) =>
  '#' +
  [1, 3, 5]
    .map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * (1 - f)).toString(16).padStart(2, '0'))
    .join('');

const style = (c: string) => ({ colourPrimary: c, colourSecondary: c, colourTertiary: darken(c) });

const blockStyles = Object.fromEntries(Object.entries(COLOURS).map(([k, c]) => [`${k}_blocks`, style(c)]));
const categoryStyles = Object.fromEntries(Object.entries(COLOURS).map(([k, c]) => [`${k}_category`, { colour: c }]));
const fontStyle = { family: '"Nunito Variable", Nunito, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif', weight: '800', size: 11.5 };

/** Chrome colours mirror the design tokens in styles.css (which also restyle the toolbox and grid). */
const define = (name: string, c: { workspace: string; toolbox: string; toolboxText: string; flyout: string; flyoutText: string; scrollbar: string; cursor: string }) =>
  Blockly.Theme.defineTheme(name, {
    name,
    base: Blockly.Themes.Classic,
    blockStyles,
    categoryStyles,
    componentStyles: {
      workspaceBackgroundColour: c.workspace,
      toolboxBackgroundColour: c.toolbox,
      toolboxForegroundColour: c.toolboxText,
      flyoutBackgroundColour: c.flyout,
      flyoutForegroundColour: c.flyoutText,
      flyoutOpacity: 1,
      scrollbarColour: c.scrollbar,
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#ffffff',
      insertionMarkerOpacity: 0.35,
      cursorColour: c.cursor,
    },
    fontStyle,
    startHats: true,
  });

const dark = define('tariro-dark', { workspace: '#1c2029', toolbox: '#1a1e27', toolboxText: '#c3c9d6', flyout: '#232937', flyoutText: '#c3c9d6', scrollbar: '#3a4256', cursor: '#ffd166' });
const light = define('tariro-light', { workspace: '#f9fafc', toolbox: '#ffffff', toolboxText: '#444e66', flyout: '#f1f4f9', flyoutText: '#444e66', scrollbar: '#c7cfdb', cursor: '#e50914' });

export const blocklyTheme = (name: 'dark' | 'light') => (name === 'light' ? light : dark);
