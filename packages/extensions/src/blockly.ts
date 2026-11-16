/**
 * Glue between our extension manifests and a Blockly instance. Blockly is passed in (not
 * imported) so the renderer and headless Node tests share exactly one Blockly copy each.
 */
import type * as BlocklyNS from 'blockly';
import { pinOptions, type BoardDefinition, type ExtensionRegistry, type PinKind, type ToolboxCategorySpec } from '@tariro-studio/core';

type Blockly = typeof BlocklyNS;

const registered = new WeakSet<object>();

/**
 * Register our custom field types and JSON-defined blocks. `getBoard` is read whenever a pin
 * dropdown opens, so switching boards immediately changes the offered pins.
 */
export function registerBlockly(Blockly: Blockly, registry: ExtensionRegistry, getBoard: () => BoardDefinition): void {
  if (registered.has(Blockly)) return;
  registered.add(Blockly);

  class FieldTariroPin extends Blockly.FieldDropdown {
    constructor(pinKind: PinKind, value?: string) {
      super(() => pinOptions(getBoard(), pinKind) as BlocklyNS.MenuOption[]);
      if (value !== undefined) this.setValue(value);
    }

    static override fromJson(options: BlocklyNS.FieldDropdownFromJsonConfig): FieldTariroPin {
      const o = options as { pinKind?: PinKind; value?: string };
      return new FieldTariroPin(o.pinKind ?? 'digital', o.value);
    }

    /** Keep a pin that the current board lacks (the generator warns instead of losing data). */
    protected override doClassValidation_(newValue?: unknown): string | null {
      return typeof newValue === 'string' && newValue.length > 0 ? newValue : null;
    }

    /** Show the stored value even when it is not in the current board's option list. */
    protected override getText_(): string | null {
      const v = this.getValue();
      return v === null ? null : String(v);
    }
  }
  Blockly.fieldRegistry.register('field_tariro_pin', FieldTariroPin as unknown as BlocklyNS.fieldRegistry.RegistrableField);

  const defs = registry
    .blocks()
    .filter((b) => !b.builtin && b.json)
    .map((b) => b.json!);
  Blockly.common.defineBlocksWithJsonArray(defs);
}

type ToolboxJson = BlocklyNS.utils.toolbox.ToolboxDefinition;

/** Blockly category-toolbox JSON for a board. */
export function buildToolbox(categories: ToolboxCategorySpec[]): ToolboxJson {
  return {
    kind: 'categoryToolbox',
    contents: categories.map((c) =>
      c.custom
        ? { kind: 'category', name: c.name, categorystyle: c.style, custom: c.custom, toolboxitemid: c.id }
        : {
            kind: 'category',
            name: c.name,
            categorystyle: c.style,
            toolboxitemid: c.id,
            contents: c.contents.map((item) =>
              item.kind === 'block'
                ? {
                    kind: 'block',
                    type: item.type,
                    ...(item.inputs ? { inputs: item.inputs } : {}),
                    ...(item.fields ? { fields: item.fields } : {}),
                    ...(item.extraState !== undefined ? { extraState: item.extraState } : {}),
                  }
                : item.kind === 'sep'
                  ? { kind: 'sep', ...(item.gap ? { gap: String(item.gap) } : {}) }
                  : { kind: 'label', text: item.text },
            ),
          },
    ),
  } as ToolboxJson;
}
