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
  tariro: '#0f6d5f',
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

export const tariroTheme = Blockly.Theme.defineTheme('tariro', {
  name: 'tariro',
  base: Blockly.Themes.Classic,
  blockStyles: Object.fromEntries(Object.entries(COLOURS).map(([k, c]) => [`${k}_blocks`, style(c)])),
  categoryStyles: Object.fromEntries(Object.entries(COLOURS).map(([k, c]) => [`${k}_category`, { colour: c }])),
  componentStyles: {
    workspaceBackgroundColour: '#f7f8fb',
    toolboxBackgroundColour: '#ffffff',
    flyoutBackgroundColour: '#eef1f6',
    flyoutOpacity: 1,
    scrollbarColour: '#c5ccd8',
  },
  fontStyle: { family: 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif', weight: '600', size: 11 },
  startHats: true,
});
