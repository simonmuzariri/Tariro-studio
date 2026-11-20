import { useState } from 'react';
import { diagnose, SYMPTOMS, type DiagnoseEvidence, type Symptom } from '@tariro-studio/core';
import { CircleHelp, Search, X } from '../ui/icons';

interface Props {
  evidence: DiagnoseEvidence;
  onClose(): void;
  /** Show a block the cause is about. */
  onFocusBlock(blockId: string): void;
}

/**
 * "Why isn't it working?" (Phase 8d): the learner says what is wrong, and the app lists what could
 * cause it. What it found evidence for comes first and says so; the rest are possibilities it cannot
 * check, with how to check them.
 */
export function DiagnoseDialog({ evidence, onClose, onFocusBlock }: Props) {
  const [symptom, setSymptom] = useState<Symptom | null>(null);
  const causes = symptom ? diagnose(symptom, evidence) : [];
  const foundCount = causes.filter((c) => c.found).length;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal diagnose" role="dialog" aria-label="Why isn't it working?" data-testid="diagnose">
        <header className="modal-head">
          <h2>
            <CircleHelp className="icon" aria-hidden="true" /> Why isn’t it working?
          </h2>
          <button type="button" className="btn ghost icon-only" onClick={onClose} aria-label="Close" data-testid="diagnose-close">
            <X className="icon" />
          </button>
        </header>
        <p className="diagnose-ask">What is wrong?</p>
        <div className="diagnose-symptoms" role="radiogroup" aria-label="What is wrong">
          {SYMPTOMS.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={symptom === s.id} className={`btn small ${symptom === s.id ? 'primary' : ''}`} onClick={() => setSymptom(s.id)} data-testid={`diagnose-${s.id}`}>
              {s.text}
            </button>
          ))}
        </div>
        {symptom && (
          <>
            <p className="diagnose-summary" data-testid="diagnose-summary">
              <Search className="icon sm" aria-hidden="true" />
              {foundCount
                ? `The app found ${foundCount === 1 ? 'one likely cause' : `${foundCount} likely causes`} in your program or circuit. Start with ${foundCount === 1 ? 'it' : 'those'}; the rest are other things it could be.`
                : 'The app found nothing wrong in your program or circuit, so here are the usual causes to check, most common first.'}
            </p>
            <ol className="diagnose-causes" data-testid="diagnose-causes">
              {causes.map((c) => (
                <li key={c.id} className={c.found ? 'found' : 'maybe'} data-testid="diagnose-cause">
                  <span className="tag">{c.found ? 'Found' : 'Could be'}</span>
                  <b>{c.title}</b>
                  <p>{c.why}</p>
                  <p className="check">
                    <i>Check:</i> {c.check}
                  </p>
                  {c.blockId && (
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => {
                        onFocusBlock(c.blockId!);
                        onClose();
                      }}
                    >
                      Show the block
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
