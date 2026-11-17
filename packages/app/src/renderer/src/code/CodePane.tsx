import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/python/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { Diagnostic, GeneratedProgram } from '@tariro-studio/core';
import { FileCode2, Lock, PencilLine } from '../ui/icons';
import { t } from '../i18n';
import type { ThemeName } from '../ui/theme';
import { PaneTabs, type RightView } from '../ui/PaneTabs';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

interface Props {
  program: GeneratedProgram;
  boardName: string;
  language: 'arduino' | 'micropython';
  theme: ThemeName;
  highlightBlockId: string | null;
  /** A specific line to reveal (e.g. a clicked compiler error). */
  revealLine: number | null;
  /** Compiler diagnostics for the code currently shown. */
  diagnostics: Diagnostic[];
  /** Code mode: the learner edits this text directly. */
  editable?: { code: string; onChange(code: string): void };
  /** Blocks mode: offer the one-way switch to code. */
  onEditAsCode?: () => void;
  /** Blocks mode: this panel shares its place with the simulator. */
  views?: { view: RightView; onView(view: RightView): void };
}

// Editor themes that sit on the app's own surfaces (tokens in styles.css) with the brand red as accent.
monaco.editor.defineTheme('tariro-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6f7889', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b85' },
    { token: 'number', foreground: 'f2b86b' },
    { token: 'string', foreground: '9ad17c' },
    { token: 'type', foreground: '6cb0ff' },
    { token: 'delimiter', foreground: 'c2c6ce' },
  ],
  colors: {
    'editor.background': '#15171c',
    'editor.foreground': '#e6e8ec',
    'editorGutter.background': '#15171c',
    'editorLineNumber.foreground': '#555b68',
    'editorLineNumber.activeForeground': '#c2c6ce',
    'editor.lineHighlightBackground': '#1f2229',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#262a33',
    'editorIndentGuide.activeBackground1': '#3b404b',
    'editor.selectionBackground': '#e5091450',
    'editorCursor.foreground': '#e50914',
    'scrollbarSlider.background': '#3b404b80',
    'scrollbarSlider.hoverBackground': '#8b909980',
    'scrollbarSlider.activeBackground': '#8b9099b0',
    'editorWidget.background': '#23262e',
    'editorWidget.border': '#3b404b',
  },
});
monaco.editor.defineTheme('tariro-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c2070f' },
    { token: 'number', foreground: '9a5b00' },
    { token: 'string', foreground: '1a7f37' },
    { token: 'type', foreground: '0b63c5' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#15171c',
    'editorLineNumber.foreground': '#a0a6b1',
    'editorLineNumber.activeForeground': '#3d434f',
    'editor.lineHighlightBackground': '#f5f6f8',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#e5091430',
    'editorCursor.foreground': '#e50914',
  },
});
export const editorTheme = (theme: ThemeName) => (theme === 'light' ? 'tariro-light' : 'tariro-dark');

/** The Arduino C++: a read-only live view of the blocks, or an editor in code mode. */
export function CodePane({ program, boardName, language, theme, highlightBlockId, revealLine, diagnostics, editable, onEditAsCode, views }: Props) {
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
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'Cascadia Mono', 'Ubuntu Mono', Menlo, monospace",
      fontSize: 13,
      lineHeight: 21,
      fontLigatures: false,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: 'all',
      folding: true,
      showFoldingControls: 'mouseover',
      guides: { indentation: true, bracketPairs: false },
      bracketPairColorization: { enabled: true },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      roundedSelection: true,
      padding: { top: 10, bottom: 10 },
      overviewRulerBorder: false,
      stickyScroll: { enabled: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      tabSize: 2,
      theme: editorTheme(theme),
    });
    // The code font loads after the editor is created; measure again so columns line up.
    void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
    editor.current = ed;
    const sub = ed.onDidChangeModelContent(() => onEdit.current?.(ed.getValue()));
    decorations.current = ed.createDecorationsCollection();
    return () => {
      sub.dispose();
      ed.dispose();
      editor.current = null;
    };
    // `theme` is only read on first mount; later changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(editorTheme(theme));
  }, [theme]);

  useEffect(() => {
    const ed = editor.current;
    if (!ed || ed.getValue() === text) return;
    const top = ed.getScrollTop();
    ed.setValue(text);
    ed.setScrollTop(top);
  }, [text]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, language === 'micropython' ? 'python' : 'cpp');
  }, [language]);

  useEffect(() => {
    editor.current?.updateOptions({ readOnly: !isEditable, domReadOnly: !isEditable });
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
    <section className="code-pane" aria-label="Generated code" hidden={views !== undefined && views.view !== 'code'}>
      <header className="pane-header">
        {views ? (
          <PaneTabs view={views.view} onView={views.onView} codeLabel={`${language === 'micropython' ? 'MicroPython' : 'Arduino C++'} · ${boardName}`} />
        ) : (
          <span className="pane-tab active" data-testid="code-title">
            <FileCode2 className="icon sm" aria-hidden="true" />
            <span>
              {language === 'micropython' ? 'MicroPython' : 'Arduino C++'} · {boardName}
            </span>
          </span>
        )}
        {isEditable ? (
          <span className="pane-hint">
            <PencilLine className="icon sm" aria-hidden="true" />
            <span>{t('code.editable')}</span>
          </span>
        ) : (
          <span className="pane-hint">
            <Lock className="icon sm" aria-hidden="true" />
            <span>{t('code.readonly')}</span>
            {onEditAsCode && (
              <button type="button" className="btn small" onClick={onEditAsCode} data-tip="Type the code yourself instead of using blocks" data-testid="edit-as-code">
                <PencilLine className="icon sm" />
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
