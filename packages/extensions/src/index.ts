import { ExtensionRegistry, type WorkspaceJson } from '@tariro-studio/core';
import { coreExtension } from './core-blocks.js';
import { ioExtension } from './io-blocks.js';
import { tariroBoardExtension } from './tariro-board.js';
import { basicExtension } from './basic.js';
import { sensorsExtension } from './sensors.js';
import { actuatorsExtension } from './actuators.js';
import { displaysExtension } from './displays.js';
import { communicationExtension } from './communication.js';
import { iotExtension } from './iot.js';

export { coreExtension, ioExtension, tariroBoardExtension, basicExtension, sensorsExtension, actuatorsExtension, displaysExtension, communicationExtension, iotExtension };
export { registerBlockly, buildToolbox } from './blockly.js';
export { EXAMPLES, type ExampleProject } from './examples.js';
export { deriveCircuit, type DerivedCircuit, type WiringStep } from './circuit.js';

export const FIRST_PARTY_EXTENSIONS = [
  coreExtension,
  ioExtension,
  tariroBoardExtension,
  basicExtension,
  sensorsExtension,
  actuatorsExtension,
  displaysExtension,
  communicationExtension,
  iotExtension,
] as const;

/** Extensions every board always has; the rest are added per project from the extension library. */
export const BUILT_IN_EXTENSIONS = new Set(['core', 'io', 'tariro-board', 'basic', 'sensors', 'actuators']);

export function createRegistry(): ExtensionRegistry {
  return new ExtensionRegistry(FIRST_PARTY_EXTENSIONS);
}

/** What a new project starts with: the program root holding an empty forever loop. */
export const STARTER_WORKSPACE: WorkspaceJson = {
  blocks: {
    languageVersion: 0,
    blocks: [{ type: 'tariro_on_start', id: 'start', x: 40, y: 40, inputs: { DO: { block: { type: 'tariro_forever', id: 'loop' } } } }],
  },
};
