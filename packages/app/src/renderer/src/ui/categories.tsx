import { Blocks, Bluetooth, Brain, Eye, Move, Music, ScanEye, Bot, Calculator, CircuitBoard, Cog, Component, Flag, Monitor, Puzzle, Radar, Repeat, Terminal, Type, Variable, Wifi, type IconType } from './icons';

/** One icon per toolbox category (by category id) and per extension pack (by extension id). */
const ICONS: Record<string, IconType> = {
  events: Flag,
  control: Repeat,
  operators: Calculator,
  variables: Variable,
  text: Type,
  functions: Blocks,
  pins: CircuitBoard,
  serial: Terminal,
  tariro: Bot,
  basic: Component,
  sensors: Radar,
  actuators: Cog,
  displays: Monitor,
  communication: Bluetooth,
  iot: Wifi,
  'cs-events': Flag,
  'cs-motion': Move,
  'cs-looks': Eye,
  'cs-sound': Music,
  'cs-control': Repeat,
  'cs-sensing': ScanEye,
  'cs-operators': Calculator,
  'cs-variables': Variable,
  'cs-vision': Brain,
};

export const categoryIcon = (id: string): IconType => ICONS[id] ?? Puzzle;
