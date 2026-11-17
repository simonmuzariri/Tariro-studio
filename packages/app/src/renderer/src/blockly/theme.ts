import * as Blockly from 'blockly';

/** Tariro Studio block palette (our own colours; WCAG-AA contrast with white block text). */
const COLOURS = {
  events: '#c77a12',
  loop: '#c4561b',
  logic: '#2f8a5a',
  math: '#2f8a5a',
  text: '#1f7f95',
  variable: '#c23b6b',
  procedure: '#7550c8',
  list: '#8a5a2b',
  pins: '#2a5fc4',
  serial: '#4a5aa0',
  // The brand red of the logo (white block text on it is 5.6:1).
  tariro: '#d6000f',
  basic: '#0f8f7a',
  sensors: '#2b8a9e',
  actuators: '#b5462e',
  displays: '#6d4fb3',
  communication: '#3b6fb6',
  iot: '#1e7d4f',
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
const fontStyle = { family: '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif', weight: '600', size: 11 };

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

const dark = define('tariro-dark', { workspace: '#1e2128', toolbox: '#17191e', toolboxText: '#c2c6ce', flyout: '#22252d', flyoutText: '#c2c6ce', scrollbar: '#3b404b', cursor: '#ffd166' });
const light = define('tariro-light', { workspace: '#f3f4f7', toolbox: '#ffffff', toolboxText: '#3d434f', flyout: '#eceef2', flyoutText: '#3d434f', scrollbar: '#c6cad3', cursor: '#e50914' });

export const blocklyTheme = (name: 'dark' | 'light') => (name === 'light' ? light : dark);
