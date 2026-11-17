import { useEffect, useLayoutEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
import { BookOpen, ChevronDown, Eraser, Loader2, Play, Square, Terminal } from '../ui/icons';
import { editorTheme } from '../code/CodePane';
import type { ThemeName } from '../ui/theme';
import type { usePython } from './usePython';
import { PYTHON_EXAMPLES } from './examples';

interface Props {
  code: string;
  onChange(code: string): void;
  theme: ThemeName;
  python: ReturnType<typeof usePython>;
  /** Why Run is not possible now (live mode running…). */
  blocked?: string | undefined;
}

/** The Python environment: Python 3 on this computer, with the board reachable through `tariro`. */
export default function PythonWorkspace({ code, onChange, theme, python, blocked }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const onEdit = useRef(onChange);
  useLayoutEffect(() => {
    onEdit.current = onChange;
  });
  const consoleEnd = useRef<HTMLDivElement>(null);
  const { phase, lines, result, version, run, stop, preload, clear } = python;
  const busy = phase !== 'idle';

  useEffect(() => {
    preload(); // Python takes a moment to start; begin as soon as the view opens
  }, [preload]);

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      value: code,
      language: 'python',
      minimap: { enabled: false },
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'Cascadia Mono', 'Ubuntu Mono', Menlo, monospace",
      fontSize: 14,
      lineHeight: 22,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 4,
      insertSpaces: true,
      padding: { top: 10, bottom: 10 },
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      theme: editorTheme(theme),
    });
    void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
    editor.current = ed;
    decorations.current = ed.createDecorationsCollection();
    const sub = ed.onDidChangeModelContent(() => {
      decorations.current?.clear();
      onEdit.current(ed.getValue());
    });
    return () => {
      sub.dispose();
      ed.dispose();
      editor.current = null;
    };
    // The text is only read on mount; the editor owns it afterwards (examples replace it below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(editorTheme(theme));
  }, [theme]);

  // Mark the line where an error happened.
  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    if (result?.outcome === 'error' && result.line) {
      decorations.current?.set([{ range: new monaco.Range(result.line, 1, result.line, 1), options: { isWholeLine: true, className: 'py-error-line', glyphMarginClassName: 'py-error-glyph' } }]);
      ed.revealLineInCenterIfOutsideViewport(result.line);
    } else decorations.current?.clear();
  }, [result]);

  useEffect(() => {
    consoleEnd.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  const openExample = (id: string) => {
    const ex = PYTHON_EXAMPLES.find((e) => e.id === id);
    const ed = editor.current;
    if (!ex || !ed) return;
    // Through an edit, so Undo brings the learner's own program back.
    ed.executeEdits('example', [{ range: ed.getModel()!.getFullModelRange(), text: ex.code }]);
    ed.pushUndoStop();
    ed.setScrollTop(0);
  };

  return (
    <section className="python-ws" data-testid="python-workspace" aria-label="Python">
      <div className="python-bar">
        {busy ? (
          <button type="button" className="btn danger" onClick={stop} disabled={phase === 'stopping'} data-testid="python-stop" data-tip="Stop the program">
            <Square className="icon" aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            onClick={() => run(editor.current?.getValue() ?? code)}
            disabled={!!blocked}
            data-testid="python-run"
            data-tip={blocked ?? 'Run the program on this computer'}
          >
            <Play className="icon" aria-hidden="true" />
            Run
          </button>
        )}
        <span className="python-status" data-testid="python-status" data-phase={phase}>
          {phase === 'loading' ? (
            <>
              <Loader2 className="icon sm spin" aria-hidden="true" /> Starting Python…
            </>
          ) : phase === 'running' ? (
            'Running…'
          ) : phase === 'stopping' ? (
            'Stopping…'
          ) : result?.outcome === 'error' ? (
            <span className="bad">{result.line ? `Error on line ${result.line}` : 'Error'}</span>
          ) : version ? (
            `Python ${version} · on this computer`
          ) : (
            'Python on this computer'
          )}
        </span>
        <span className="spacer" />
        <label className="picker" data-tip="Open an example (Undo brings your program back)">
          <BookOpen className="icon" aria-hidden="true" />
          <span className="sr-only">Examples</span>
          <select value="" onChange={(e) => openExample(e.target.value)} disabled={busy} data-testid="python-examples">
            <option value="" disabled>
              Examples
            </option>
            {PYTHON_EXAMPLES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <ChevronDown className="icon sm chev" aria-hidden="true" />
        </label>
      </div>
      <div className="python-editor" ref={host} data-testid="python-editor" />
      <div className="python-console" role="log" aria-label="Python console" data-testid="python-console">
        <div className="python-console-head">
          <Terminal className="icon sm" aria-hidden="true" />
          Console
          <span className="spacer" />
          <button type="button" className="btn ghost icon-only" onClick={clear} aria-label="Clear the console" data-tip="Clear">
            <Eraser className="icon sm" />
          </button>
        </div>
        <div className="python-console-body">
          {lines.length === 0 && <div className="py-line info">Output from print() appears here.</div>}
          {lines.map((l) => (
            <div key={l.id} className={`py-line ${l.stream}`}>
              {l.text || ' '}
            </div>
          ))}
          <div ref={consoleEnd} />
        </div>
      </div>
    </section>
  );
}

