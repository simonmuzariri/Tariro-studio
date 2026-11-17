import { useEffect, useRef, useState } from 'react';
import type { RecentProject } from '@tariro-studio/core';
import { EXAMPLES, type ExampleProject } from '@tariro-studio/extensions';
import { BookOpen, ChevronDown, FileOutput, FilePlus, FolderClock, FolderOpen, Menu, Save, SaveAll, type IconType } from '../ui/icons';
import { t } from '../i18n';

interface Props {
  recent: RecentProject[];
  onNew(): void;
  onOpen(): void;
  onOpenRecent(path: string): void;
  onExample(ex: ExampleProject): void;
  onSave(): void;
  onSaveAs(): void;
  onExport(): void;
}

const isMac = navigator.userAgent.includes('Mac');
const mod = isMac ? '⌘' : 'Ctrl+';

/** File menu (in-app, so it looks the same on Windows and Linux) plus its keyboard shortcuts. */
export function FileMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const handlers = useRef(p);
  useEffect(() => {
    handlers.current = p;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const h = handlers.current;
      const act = k === 'n' ? h.onNew : k === 'o' ? h.onOpen : k === 's' ? (e.shiftKey ? h.onSaveAs : h.onSave) : undefined;
      if (act) {
        e.preventDefault();
        setOpen(false);
        act();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const kits = [...new Set(EXAMPLES.map((e) => e.kit))];

  return (
    <div className="file-menu" ref={root}>
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-tip="New, open, save and example projects" data-testid="file-menu">
        <Menu className="icon" aria-hidden="true" />
        {t('file.menu')}
        <ChevronDown className="icon sm" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <MenuItem icon={FilePlus} label={t('file.new')} shortcut={`${mod}N`} onClick={run(p.onNew)} testId="menu-new" />
          <MenuItem icon={FolderOpen} label={t('file.open')} shortcut={`${mod}O`} onClick={run(p.onOpen)} testId="menu-open" />
          <MenuItem icon={Save} label={t('file.save')} shortcut={`${mod}S`} onClick={run(p.onSave)} testId="menu-save" />
          <MenuItem icon={SaveAll} label={t('file.saveAs')} shortcut={`${mod}${isMac ? '⇧' : 'Shift+'}S`} onClick={run(p.onSaveAs)} testId="menu-save-as" />
          <div className="menu-sep" />
          <MenuItem icon={FileOutput} label={t('file.export')} onClick={run(p.onExport)} testId="menu-export" />
          {p.recent.length > 0 && (
            <>
              <div className="menu-heading">{t('file.recent')}</div>
              {p.recent.map((r) => (
                <MenuItem key={r.path} icon={FolderClock} label={r.name} hint={r.path} onClick={run(() => p.onOpenRecent(r.path))} />
              ))}
            </>
          )}
          {kits.map((kit) => (
            <div key={kit}>
              <div className="menu-heading">{t('file.examples', { kit })}</div>
              {EXAMPLES.filter((e) => e.kit === kit).map((ex) => (
                <MenuItem key={ex.name} icon={BookOpen} label={ex.title} hint={ex.description} onClick={run(() => p.onExample(ex))} testId={`example-${ex.name}`} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, shortcut, hint, onClick, testId }: { icon: IconType; label: string; shortcut?: string; hint?: string; onClick(): void; testId?: string }) {
  return (
    <button type="button" role="menuitem" className="menu-item" onClick={onClick} data-tip={hint} data-testid={testId}>
      <Icon className="icon" aria-hidden="true" />
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}
