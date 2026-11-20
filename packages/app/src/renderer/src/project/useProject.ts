import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  PYTHON_STARTER,
  defaultStage,
  type ImageModel,
  newImageModel,
  type Stage,
  DEFAULT_BOARD_ID,
  newProject,
  projectFingerprint,
  type CircuitLayout,
  type Project,
  type RecentProject,
  type RecoverableProject,
  type ThumbnailArea,
  type WorkspaceJson,
} from '@tariro-studio/core';
import { STARTER_WORKSPACE, type ExampleProject } from '@tariro-studio/extensions';

const AUTOSAVE_MS = 30_000;
const now = () => new Date().toISOString();

export interface Confirm {
  title: string;
  message: string;
  onSave(): void;
  onDiscard(): void;
}

interface Doc {
  project: Project;
  path: string | null;
  /** Fingerprint of the last saved/opened content; '' means "never saved". */
  savedFp: string;
  /** Changes whenever a different project is loaded (remounts the block workspace). */
  key: number;
}

const starter = (board: string, appVersion: string): Project =>
  newProject({ board, workspace: STARTER_WORKSPACE as Record<string, unknown>, appVersion });

/**
 * The open project: content, file path, unsaved-changes tracking, autosave, and the guard that
 * asks before discarding work (New / Open / Example / closing the window).
 */
export function useProject(appVersion: string, thumbnailArea: () => ThumbnailArea | null) {
  const [doc, setDoc] = useState<Doc>(() => {
    const p = starter(DEFAULT_BOARD_ID, appVersion);
    return { project: p, path: null, savedFp: projectFingerprint(p), key: 0 };
  });
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [recoverable, setRecoverable] = useState<RecoverableProject[]>([]);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastAutosaveFp = useRef('');

  const fingerprint = useMemo(() => projectFingerprint(doc.project), [doc.project]);
  const dirty = fingerprint !== doc.savedFp;

  const load = useCallback((project: Project, path: string | null, clean = true) => {
    setDoc((d) => ({ project, path, savedFp: clean ? projectFingerprint(project) : '', key: d.key + 1 }));
    setError(null);
  }, []);

  /**
   * Blockly re-serialises a workspace when it loads it (new ids for id-less blocks, normalised
   * fields). Such a 'load' keeps a clean project clean; only 'edit' changes count as unsaved work.
   */
  const setWorkspace = useCallback((workspace: WorkspaceJson, origin: 'load' | 'edit') => {
    setDoc((d) => {
      const project = { ...d.project, workspace: workspace as Record<string, unknown> };
      const wasClean = projectFingerprint(d.project) === d.savedFp;
      return origin === 'load' && wasClean ? { ...d, project, savedFp: projectFingerprint(project) } : { ...d, project };
    });
  }, []);
  const setBoard = useCallback((board: string) => setDoc((d) => ({ ...d, project: { ...d.project, board } })), []);
  const setName = useCallback((name: string) => setDoc((d) => ({ ...d, project: { ...d.project, name } })), []);
  const setExtensions = useCallback(
    (extensions: string[]) => setDoc((d) => ({ ...d, project: { ...d.project, extensions: [...new Set(extensions)].sort() } })),
    [],
  );

  // Tell main, so closing the window can ask first.
  useEffect(() => {
    void window.studio.window.setDirty(dirty);
  }, [dirty]);

  const refreshRecent = useCallback(() => {
    window.studio.project.recent().then(setRecent, () => setRecent([]));
  }, []);

  useEffect(() => {
    refreshRecent();
    window.studio.project.recoverable().then(setRecoverable, () => setRecoverable([]));
  }, [refreshRecent]);

  // Autosave for crash recovery: every 30 s while there are unsaved changes, and when the window loses focus.
  const docRef = useRef(doc);
  useLayoutEffect(() => {
    docRef.current = doc;
  }, [doc]);
  const autosave = useCallback(() => {
    const d = docRef.current;
    const fp = projectFingerprint(d.project);
    if (fp === d.savedFp || fp === lastAutosaveFp.current) return;
    lastAutosaveFp.current = fp;
    void window.studio.project.autosave({ ...d.project, name: d.project.name.trim() || 'My Project', modifiedAt: now(), appVersion });
  }, [appVersion]);
  useEffect(() => {
    const t = setInterval(autosave, AUTOSAVE_MS);
    window.addEventListener('blur', autosave);
    return () => {
      clearInterval(t);
      window.removeEventListener('blur', autosave);
    };
  }, [autosave]);

  const save = useCallback(
    async (saveAs = false): Promise<boolean> => {
      const d = docRef.current;
      const project: Project = { ...d.project, name: d.project.name.trim() || 'My Project', modifiedAt: now(), appVersion };
      const r = await window.studio.project.save(saveAs ? null : d.path, project, thumbnailArea());
      if (r === null) return false; // dialog cancelled
      if ('error' in r) {
        setError(r.error);
        return false;
      }
      setDoc((cur) => ({ ...cur, project, path: r.path, savedFp: projectFingerprint(project) }));
      setNotice(`Saved to ${r.path}`);
      refreshRecent();
      return true;
    },
    [appVersion, refreshRecent, thumbnailArea],
  );

  /** Run `action` now, or after asking what to do with unsaved changes. */
  const guard = useCallback(
    (action: () => void, what = 'continuing') => {
      if (!dirty) return action();
      setConfirm({
        title: 'Save your changes?',
        message: `"${docRef.current.project.name}" has changes that are not saved. Save them before ${what}?`,
        onSave: () => {
          setConfirm(null);
          void save().then((ok) => ok && action());
        },
        onDiscard: () => {
          setConfirm(null);
          action();
        },
      });
    },
    [dirty, save],
  );

  const openResult = useCallback(
    (r: Awaited<ReturnType<typeof window.studio.project.open>> | null) => {
      if (!r) return;
      if ('error' in r) return setError(r.error);
      load(r.project, r.path);
      refreshRecent();
    },
    [load, refreshRecent],
  );

  /** One-way switch from blocks to hand-edited C++ (IDE_DESIGN.md §1.9). The blocks are dropped. */
  const convertToCode = useCallback((code: string, usedExtensions: string[]) => {
    setDoc((d) => {
      const { workspace: _dropped, ...rest } = d.project;
      void _dropped;
      return { ...d, project: { ...rest, mode: 'code', code, extensions: [...new Set([...d.project.extensions, ...usedExtensions])].sort() } };
    });
  }, []);
  const setLanguage = useCallback((language: 'arduino' | 'micropython') => setDoc((d) => ({ ...d, project: { ...d.project, language } })), []);
  /** The workbench layout; an empty bench is stored as no bench, so a fresh project stays unchanged. */
  /** The Python program; the starter text (or nothing) leaves the project without a Python section. */
  const setPython = useCallback(
    (python: string) =>
      setDoc((d) => {
        const rest = { ...d.project };
        delete rest.python;
        return { ...d, project: python.trim() && python !== PYTHON_STARTER ? { ...rest, python } : rest };
      }),
    [],
  );
  /** Creative Studio's stage; the untouched starter stage is not stored. */
  const setStage = useCallback(
    (stage: Stage) =>
      setDoc((d) => {
        const rest = { ...d.project };
        delete rest.stage;
        return { ...d, project: JSON.stringify(stage) === JSON.stringify(defaultStage()) ? rest : { ...rest, stage } };
      }),
    [],
  );
  /** The AI image classifier (classes, pictures' features, trained model). */
  const setDrone = useCallback(
    (drone: NonNullable<Project['drone']>) =>
      setDoc((d) => ({ ...d, project: { ...d.project, drone } })),
    [],
  );
  /** Gesture and sound models (4f): stored once the learner has changed anything. */
  const setModel = useCallback(
    (key: 'sound' | 'gesture', m: ImageModel) =>
      setDoc((d) => {
        const rest = { ...d.project };
        delete rest[key];
        return { ...d, project: m.classes.every((c) => c.samples.length === 0) && !m.trained && m.classes.length <= 2 ? rest : { ...rest, [key]: m } };
      }),
    [],
  );
  const setSound = useCallback((m: ImageModel) => setModel('sound', m), [setModel]);
  const setGesture = useCallback((m: ImageModel) => setModel('gesture', m), [setModel]);
  const setAi = useCallback(
    (ai: ImageModel) =>
      setDoc((d) => {
        const rest = { ...d.project };
        delete rest.ai;
        // An untouched starter model is not stored; anything the learner changed is (even a name).
        return { ...d, project: JSON.stringify(ai) === JSON.stringify(newImageModel()) ? rest : { ...rest, ai } };
      }),
    [],
  );
  const setCircuit = useCallback(
    (circuit: CircuitLayout | undefined) =>
      setDoc((d) => {
        const { circuit: _old, ...rest } = d.project;
        void _old;
        // An empty bench is not saved, unless the learner chose to put the board or breadboard on it (or away).
        return { ...d, project: circuit && (circuit.parts.length || circuit.wires.length || circuit.breadboard !== undefined || circuit.board !== undefined || circuit.breadboardSize || circuit.breadboardAt || circuit.boardAt) ? { ...rest, circuit } : rest };
      }),
    [],
  );
  const setCode = useCallback((code: string) => setDoc((d) => (d.project.mode === 'code' ? { ...d, project: { ...d.project, code } } : d)), []);

  const actions = {
    newProject: () => guard(() => load(starter(docRef.current.project.board, appVersion), null), 'starting a new project'),
    open: () => guard(() => void window.studio.project.openDialog().then(openResult), 'opening another project'),
    openPath: (path: string) => guard(() => void window.studio.project.open(path).then(openResult), 'opening another project'),
    openExample: (ex: ExampleProject) =>
      guard(
        () =>
          load(
            {
              ...newProject({
                board: ex.boards[0]!,
                workspace: ex.workspace as Record<string, unknown>,
                appVersion,
                name: ex.title,
                extensions: [...(ex.extensions ?? [])].sort(),
              }),
              ...(ex.stage ? { stage: structuredClone(ex.stage) } : {}),
              ...(ex.ai ? { ai: structuredClone(ex.ai) } : {}),
              ...(ex.layout ? { circuit: structuredClone(ex.layout) } : {}),
            },
            null,
          ),
        'opening the example',
      ),
    save: () => void save(false),
    saveAs: () => void save(true),
    exportSketch: async (code: string, kind: 'ino' | 'py') => {
      const r = await window.studio.project.exportSketch(code, docRef.current.project.name, kind);
      if (r && 'error' in r) setError(r.error);
      else if (r) setNotice(`Exported ${r.path}`);
    },
    recover: async (id: string) => {
      const r = await window.studio.project.recover(id);
      setRecoverable([]);
      if ('error' in r) return setError(r.error);
      load(r, null, false); // recovered work is unsaved until the learner saves it
      setNotice(`Recovered "${r.name}". Save it to keep it.`);
    },
    dismissRecovery: () => {
      setRecoverable([]);
      void window.studio.project.dismissRecovery();
    },
  };

  // OS "open with" and window close requests go through the same guard.
  useEffect(() => {
    const offOpen = window.studio.project.onOpenRequest(({ path }) => actions.openPath(path));
    const offClose = window.studio.window.onCloseRequested(() => guard(() => void window.studio.window.confirmClose(), 'closing'));
    return () => {
      offOpen();
      offClose();
    };
  });

  return {
    project: doc.project,
    path: doc.path,
    key: doc.key,
    dirty,
    setWorkspace,
    setBoard,
    setName,
    setExtensions,
    convertToCode,
    setLanguage,
    setCode,
    setCircuit,
    setPython,
    setStage,
    setAi,
    setSound,
    setGesture,
    setDrone,
    actions,
    confirm,
    cancelConfirm: () => setConfirm(null),
    recoverable,
    recent,
    error,
    clearError: () => setError(null),
    notice,
    clearNotice: () => setNotice(null),
  };
}
