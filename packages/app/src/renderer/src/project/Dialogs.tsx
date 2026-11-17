import { useEffect, useRef } from 'react';
import type { RecoverableProject } from '@tariro-studio/core';
import type { Confirm } from './useProject';
import { CircleAlert, CircleCheck, CircleHelp, History, X, type IconType } from '../ui/icons';
import { t } from '../i18n';

function Modal({ title, icon: Icon = CircleHelp, children, onEscape }: { title: string; icon?: IconType; children: React.ReactNode; onEscape(): void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onEscape();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onEscape]);
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <h2>
          <Icon className="icon" aria-hidden="true" />
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ confirm, onCancel }: { confirm: Confirm; onCancel(): void }) {
  return (
    <Modal title={confirm.title} onEscape={onCancel}>
      <p>{confirm.message}</p>
      <div className="modal-actions">
        <button type="button" className="btn solid" onClick={confirm.onSave} data-testid="confirm-save">
          Save
        </button>
        <button type="button" className="btn plain" onClick={confirm.onDiscard} data-testid="confirm-discard">
          Don’t save
        </button>
        <button type="button" className="btn plain" onClick={onCancel} data-testid="confirm-cancel">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function ChoiceDialog({ title, message, confirmLabel, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; onConfirm(): void; onCancel(): void }) {
  return (
    <Modal title={title} onEscape={onCancel}>
      <p>{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn plain" onClick={onCancel} data-testid="choice-cancel">
          {t('common.cancel')}
        </button>
        <button type="button" className="btn solid" onClick={onConfirm} data-testid="choice-confirm">
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function RecoveryDialog({ items, onRecover, onDismiss }: { items: RecoverableProject[]; onRecover(id: string): void; onDismiss(): void }) {
  return (
    <Modal title="Recover your work?" icon={History} onEscape={onDismiss}>
      <p>Tariro Studio closed unexpectedly. These projects had changes that were not saved:</p>
      <ul className="recover-list">
        {items.map((r) => (
          <li key={r.id}>
            <span>
              <strong>{r.name}</strong>
              <small>{new Date(r.modifiedAt).toLocaleString()}</small>
            </span>
            <button type="button" className="btn solid" onClick={() => onRecover(r.id)} data-testid="recover">
              Recover
            </button>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button type="button" className="btn plain" onClick={onDismiss} data-testid="recover-dismiss">
          Start fresh
        </button>
      </div>
    </Modal>
  );
}

export function Toast({ kind, message, onClose }: { kind: 'error' | 'info'; message: string; onClose(): void }) {
  useEffect(() => {
    if (kind === 'info') {
      const t = setTimeout(onClose, 4000);
      return () => clearTimeout(t);
    }
  }, [kind, message, onClose]);
  return (
    <div className={`toast ${kind}`} role={kind === 'error' ? 'alert' : 'status'} data-testid={`toast-${kind}`}>
      {kind === 'error' ? <CircleAlert className="icon" aria-hidden="true" /> : <CircleCheck className="icon" aria-hidden="true" />}
      <span>{message}</span>
      <button type="button" className="link" onClick={onClose} aria-label="Dismiss">
        <X className="icon sm" />
      </button>
    </div>
  );
}
