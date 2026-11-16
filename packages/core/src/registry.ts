import type {
  BoardDefinition,
  BlockSpec,
  Emitter,
  ExtensionManifest,
  Language,
  ToolboxCategorySpec,
} from './types.js';

const supports = (boards: string[] | '*' | undefined, board: BoardDefinition): boolean =>
  boards === undefined || boards === '*' || boards.includes(board.id);

/** All loaded extensions, indexed for the generator and the toolbox builder. */
export class ExtensionRegistry {
  private readonly manifests = new Map<string, ExtensionManifest>();
  private readonly blockOwner = new Map<string, ExtensionManifest>();

  constructor(manifests: Iterable<ExtensionManifest> = []) {
    for (const m of manifests) this.add(m);
  }

  add(m: ExtensionManifest): void {
    if (this.manifests.has(m.id)) throw new Error(`Extension "${m.id}" registered twice`);
    for (const b of m.blocks) {
      const owner = this.blockOwner.get(b.type);
      if (owner) throw new Error(`Block "${b.type}" defined by both "${owner.id}" and "${m.id}"`);
      this.blockOwner.set(b.type, m);
    }
    this.manifests.set(m.id, m);
  }

  get(id: string): ExtensionManifest | undefined {
    return this.manifests.get(id);
  }

  all(): ExtensionManifest[] {
    return [...this.manifests.values()];
  }

  blocks(): BlockSpec[] {
    return this.all().flatMap((m) => m.blocks);
  }

  ownerOf(blockType: string): ExtensionManifest | undefined {
    return this.blockOwner.get(blockType);
  }

  /** Libraries needed by the given block types on a board, deduplicated by name. */
  librariesFor(blockTypes: Iterable<string>, board: BoardDefinition): Array<{ name: string; version: string }> {
    const out = new Map<string, string>();
    const owners = new Set([...blockTypes].map((t) => this.blockOwner.get(t)).filter((m): m is ExtensionManifest => !!m));
    for (const m of owners)
      for (const lib of m.libraries ?? []) if (!lib.families || lib.families.includes(board.family)) out.set(lib.name, lib.version);
    return [...out].map(([name, version]) => ({ name, version }));
  }

  /** Libraries of whole extensions on a board (code mode: there are no blocks to inspect). */
  librariesForExtensions(ids: Iterable<string>, board: BoardDefinition): Array<{ name: string; version: string }> {
    const out = new Map<string, string>();
    for (const id of ids)
      for (const lib of this.manifests.get(id)?.libraries ?? [])
        if (!lib.families || lib.families.includes(board.family)) out.set(lib.name, lib.version);
    return [...out].map(([name, version]) => ({ name, version }));
  }

  emitter(language: Language, blockType: string): Emitter | undefined {
    return this.blockOwner.get(blockType)?.emitters[language]?.[blockType];
  }

  /** Whether a block type may be used with a board (extension and block-level filters). */
  blockSupported(blockType: string, board: BoardDefinition): boolean {
    const m = this.blockOwner.get(blockType);
    if (!m) return false;
    const spec = m.blocks.find((b) => b.type === blockType);
    return supports(m.boards, board) && supports(spec?.boards, board);
  }

  /** Extensions active for a board: the board's defaults plus any extra ones the project enabled. */
  activeFor(board: BoardDefinition, extra: string[] = []): ExtensionManifest[] {
    const ids = new Set([...board.defaultExtensions, ...extra]);
    return this.all().filter((m) => ids.has(m.id) && supports(m.boards, board));
  }

  /** Toolbox categories for a board, in extension order. */
  toolboxFor(board: BoardDefinition, extra: string[] = []): ToolboxCategorySpec[] {
    return this.activeFor(board, extra)
      .flatMap((m) => m.toolbox)
      .filter((c) => supports(c.boards, board))
      .map((c) => ({
        ...c,
        contents: c.contents.filter((item) => item.kind !== 'block' || this.blockSupported(item.type, board)),
      }));
  }
}
