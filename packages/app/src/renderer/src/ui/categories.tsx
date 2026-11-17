import { Blocks, Bluetooth, Bot, Calculator, CircuitBoard, Cog, Component, Flag, Monitor, Puzzle, Radar, Repeat, Terminal, Type, Variable, Wifi, type LucideIcon } from 'lucide-react';

/** One icon per toolbox category (by category id) and per extension pack (by extension id). */
const ICONS: Record<string, LucideIcon> = {
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
};

export const categoryIcon = (id: string): LucideIcon => ICONS[id] ?? Puzzle;
