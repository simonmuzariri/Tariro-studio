import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/cpp/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { Diagnostic, GeneratedProgram } from '@tariro-studio/core';
import { t } from '../i18n';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

interface Props {
  program: GeneratedProgram;
  boardName: string;
  highlightBlockId: string | null;
  /** A specific line to reveal (e.g. a clicked compiler error). */
  revealLine: number | null;
  /** Compiler diagnostics for the code currently shown. */
  diagnostics: Diagnostic[];
  /** Code mode: the learner edits this text directly. */
  editable?: { code: string; onChange(code: string): void };
  /** Blocks mode: offer the one-way switch to code. */
  onEditAsCode?: () => void;
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** The Arduino C++: a read-only live view of the blocks, or an editor in code mode. */
export function CodePane({ program, boardName, highlightBlockId, revealLine, diagnostics, editable, onEditAsCode }: Props) {
  const text = editable ? editable.code : program.code;
  const onEdit = useRef(editable?.onChange);
  useEffect(() => {
    onEdit.current = editable?.onChange;
  });
  const isEditable = editable !== undefined;
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      value: '',
      language: 'cpp',
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: 'none',
      theme: darkQuery.matches ? 'vs-dark' : 'vs',
    });
    editor.current = ed;
    const sub = ed.onDidChangeModelContent(() => onEdit.current?.(ed.getValue()));
    decorations.current = ed.createDecorationsCollection();
    const onScheme = () => monaco.editor.setTheme(darkQuery.matches ? 'vs-dark' : 'vs');
    darkQuery.addEventListener('change', onScheme);
    return () => {
      darkQuery.removeEventListener('change', onScheme);
      sub.dispose();
      ed.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const ed = editor.current;
    if (!ed || ed.getValue() === text) return;
    const top = ed.getScrollTop();
    ed.setValue(text);
    ed.setScrollTop(top);
  }, [text]);

  useEffect(() => {
    editor.current?.updateOptions({ readOnly: !isEditable, domReadOnly: !isEditable, renderLineHighlight: isEditable ? 'line' : 'none' });
  }, [isEditable]);

  // Highlight the lines produced by the selected block.
  useEffect(() => {
    const ed = editor.current;
    if (!ed || !decorations.current) return;
    const lines = revealLine
      ? [revealLine]
      : highlightBlockId
        ? program.sourceMap.filter((m) => m.blockId === highlightBlockId).map((m) => m.line)
        : [];
    decorations.current.set(
      lines.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'code-highlight', linesDecorationsClassName: 'code-highlight-gutter' },
      })),
    );
    if (lines[0]) ed.revealLineInCenterIfOutsideViewport(lines[0]);
  }, [highlightBlockId, revealLine, program]);

  // Compiler errors and warnings as squiggles in the editor.
  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      'compiler',
      diagnostics.map((d) => ({
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: d.message,
        startLineNumber: d.line,
        endLineNumber: d.line,
        startColumn: d.column ?? 1,
        endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
      })),
    );
  }, [diagnostics, text]);

  return (
    <section className="code-pane" aria-label="Generated Arduino code">
      <header className="pane-header">
        <span>Arduino C++ · {boardName}</span>
        {isEditable ? (
          <span className="pane-hint">{t('code.editable')}</span>
        ) : (
          <span className="pane-hint">
            {t('code.readonly')}
            {onEditAsCode && (
              <button type="button" className="btn small" onClick={onEditAsCode} data-testid="edit-as-code">
                {t('code.editAsCode')}
              </button>
            )}
          </span>
        )}
      </header>
      <div ref={host} className="monaco-host" data-testid="code-view" />
    </section>
  );
}
