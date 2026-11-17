import { Puzzle } from './icons';

/** Under the toolbox categories: add the blocks for more parts (the extension library). */
export function AddExtensionButton({ onClick }: { onClick(): void }) {
  return (
    <button type="button" className="add-extension" onClick={onClick} data-tip="Extensions: add blocks for the parts in your kit" data-testid="extensions-button">
      <Puzzle className="icon" aria-hidden="true" />
      <span>Add</span>
    </button>
  );
}
