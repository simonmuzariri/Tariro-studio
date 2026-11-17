import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  encodeEmbedding,
  loadClassifier,
  MAX_CLASSES,
  MAX_SAMPLES_PER_CLASS,
  newImageModel,
  trainImageModel,
  trainingProblem,
  type ImageModel,
  type Prediction,
} from '@tariro-studio/core';
import { Camera, LoaderCircle, Plus, Trash2, X, Zap } from '../ui/icons';
import { camera, useCamera } from './camera';
import { loadVision, thumbnail, type VisionEngine } from './vision';

interface Props {
  model: ImageModel | undefined;
  onChange(model: ImageModel): void;
  onClose(): void;
}

/** One picture every 120 ms while "Hold to record" is held down (about 8 a second). */
const RECORD_MS = 120;

const describeAccuracy = (t: NonNullable<ImageModel['trained']>) =>
  t.accuracy === null
    ? `Learned from ${t.samples} pictures. Give every class 10 or more pictures and it also tests itself on pictures it has not seen.`
    : `Learned from ${t.samples} pictures. On pictures it had not seen, it was right ${Math.round(t.accuracy * 100)} % of the time.`;

/**
 * Teach the computer to recognise things with the camera: classes, pictures for each, training on
 * this computer, and a live preview of what the model sees.
 */
export default function ClassifierPanel({ model: given, onChange, onClose }: Props) {
  const model = given ?? newImageModel();
  const cam = useCamera();
  const [vision, setVision] = useState<VisionEngine | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [training, setTraining] = useState<number | null>(null);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  /** The first picture from a camera prepares the AI for its size (slow once); Record waits for it. */
  const [warm, setWarm] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const latest = useRef({ model, onChange });
  useLayoutEffect(() => {
    latest.current = { model, onChange };
  });

  // Load the AI engine and switch the camera on when the panel opens.
  useEffect(() => {
    let live = true;
    loadVision().then(
      (v) => live && setVision(v),
      (e: unknown) => live && setVisionError(`The AI engine could not start: ${e instanceof Error ? e.message : String(e)}`),
    );
    if (!camera.snapshot.on) void camera.start();
    return () => {
      live = false;
    };
  }, []);

  // Show the shared camera picture in the preview.
  useEffect(() => {
    const host = preview.current;
    if (!host) return;
    camera.video.className = 'cam-video';
    host.prepend(camera.video);
    return () => camera.video.remove();
  }, []);

  useEffect(() => {
    if (!vision || !cam.on || warm) return;
    const t = setInterval(() => {
      if (!camera.ready) return;
      clearInterval(t);
      vision.embed(camera.video);
      setWarm(true);
    }, 100);
    return () => clearInterval(t);
  }, [vision, cam.on, warm]);

  // Live prediction, about 8 times a second, once a model is trained.
  const trained = model.trained;
  useEffect(() => {
    if (!vision || !trained || !cam.on) return;
    const classify = loadClassifier(trained);
    const t = setInterval(() => {
      if (camera.ready) setPrediction(classify(vision.embed(camera.video)));
    }, 125);
    return () => clearInterval(t);
  }, [vision, trained, cam.on]);

  // Record while the button is held.
  useEffect(() => {
    if (!recording || !vision) return;
    const t = setInterval(() => {
      if (!camera.ready) return;
      const { model: m, onChange: emit } = latest.current;
      const c = m.classes.find((x) => x.id === recording);
      if (!c || c.samples.length >= MAX_SAMPLES_PER_CLASS) return;
      const e = encodeEmbedding(vision.embed(camera.video));
      const thumbs = [...(c.thumbs ?? []), thumbnail(camera.video)].slice(-12);
      // New pictures make the old training out of date.
      emit({ classes: m.classes.map((x) => (x.id === c.id ? { ...x, samples: [...x.samples, e], thumbs } : x)) });
    }, RECORD_MS);
    const stop = () => setRecording(null);
    window.addEventListener('pointerup', stop);
    return () => {
      clearInterval(t);
      window.removeEventListener('pointerup', stop);
    };
  }, [recording, vision]);

  const edit = (classes: ImageModel['classes']) => onChange({ classes });
  const problem = trainingProblem(model);

  const train = async () => {
    if (!vision || problem) return;
    setTrainError(null);
    setTraining(0);
    try {
      const t = await trainImageModel(vision.tf, model, {
        onEpoch: async (p) => {
          setTraining(p);
          await new Promise((r) => setTimeout(r, 0)); // let the progress bar draw
        },
      });
      onChange({ ...latest.current.model, trained: t });
    } catch (e) {
      setTrainError(e instanceof Error ? e.message : String(e));
    } finally {
      setTraining(null);
    }
  };

  const nextId = () => {
    for (let i = 1; ; i++) if (!model.classes.some((c) => c.id === `class-${i}`)) return `class-${i}`;
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal ai-panel" role="dialog" aria-label="Image classifier" data-testid="ai-panel">
        <header className="ai-head">
          <h2>
            <Zap className="icon" aria-hidden="true" />
            Teach the computer to see
          </h2>
          <p>Show the camera a few examples of each thing. The pictures stay on this computer.</p>
          <button type="button" className="btn ghost icon-only" onClick={onClose} aria-label="Close" data-testid="ai-close">
            <X className="icon" />
          </button>
        </header>
        <div className="ai-body">
          <div className="ai-classes">
            {model.classes.map((c) => (
              <div key={c.id} className={`ai-class${recording === c.id ? ' recording' : ''}`} data-testid={`ai-class-${c.id}`}>
                <div className="ai-class-head">
                  <input
                    value={c.name}
                    maxLength={40}
                    onChange={(e) => edit(model.classes.map((x) => (x.id === c.id ? { ...x, name: e.target.value || ' ' } : x)))}
                    aria-label="Class name"
                    data-testid={`ai-name-${c.id}`}
                  />
                  <span className="ai-count" data-testid={`ai-count-${c.id}`}>
                    {c.samples.length} pictures
                  </span>
                  {model.classes.length > 2 && (
                    <button type="button" className="btn ghost icon-only small" onClick={() => edit(model.classes.filter((x) => x.id !== c.id))} aria-label={`Delete ${c.name}`} data-tip="Delete this class">
                      <Trash2 className="icon sm" />
                    </button>
                  )}
                </div>
                <div className="ai-thumbs">
                  {(c.thumbs ?? []).map((t, i) => (
                    <img key={i} src={t} alt="" />
                  ))}
                  {c.samples.length === 0 && <span className="ai-hint">No pictures yet</span>}
                </div>
                <div className="ai-class-actions">
                  <button
                    type="button"
                    className="btn small record"
                    disabled={!vision || !cam.on || !warm || c.samples.length >= MAX_SAMPLES_PER_CLASS}
                    onPointerDown={() => setRecording(c.id)}
                    data-tip="Hold down to take pictures (about 8 a second). Move the object a little so the computer sees it from different sides."
                    data-testid={`ai-record-${c.id}`}
                  >
                    <Camera className="icon sm" aria-hidden="true" />
                    {recording === c.id ? 'Recording…' : 'Hold to record'}
                  </button>
                  {c.samples.length > 0 && (
                    <button type="button" className="btn small ghost" onClick={() => edit(model.classes.map((x) => (x.id === c.id ? { ...x, samples: [], thumbs: [] } : x)))} data-testid={`ai-clear-${c.id}`}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            ))}
            {model.classes.length < MAX_CLASSES && (
              <button type="button" className="btn plain ai-add" onClick={() => edit([...model.classes, { id: nextId(), name: `Class ${model.classes.length + 1}`, samples: [] }])} data-testid="ai-add-class">
                <Plus className="icon sm" aria-hidden="true" />
                Add a class
              </button>
            )}
          </div>

          <div className="ai-train">
            <button type="button" className="btn primary" onClick={() => void train()} disabled={!vision || !!problem || training !== null} data-tip={problem ?? 'Train the model on this computer'} data-testid="ai-train">
              {training !== null ? <LoaderCircle className="icon spin" aria-hidden="true" /> : <Zap className="icon" aria-hidden="true" />}
              {training !== null ? 'Training…' : trained ? 'Train again' : 'Train model'}
            </button>
            {training !== null && <progress max={1} value={training} data-testid="ai-progress" />}
            <p className="ai-note" data-testid="ai-train-note">
              {trainError ?? (training !== null ? 'Learning from your pictures…' : trained ? describeAccuracy(trained) : (problem ?? 'Ready to train.'))}
            </p>
          </div>

          <div className="ai-preview">
            <div className="ai-video" ref={preview}>
              {!cam.on && <p className="ai-video-off">{cam.starting ? 'Starting the camera…' : (cam.error ?? 'The camera is off.')}</p>}
            </div>
            <div className="ai-cam-row">
              {cam.devices.length > 1 && (
                <select value={cam.deviceId ?? ''} onChange={(e) => void camera.start(e.target.value)} aria-label="Camera" data-testid="ai-camera-select">
                  {cam.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn small" onClick={() => (cam.on ? camera.stop() : void camera.start())} data-testid="ai-camera-toggle">
                {cam.on ? 'Turn camera off' : 'Turn camera on'}
              </button>
            </div>
            {(!vision || (cam.on && !warm)) && !visionError && (
              <p className="ai-note">
                <LoaderCircle className="icon sm spin" aria-hidden="true" /> Loading the AI…
              </p>
            )}
            {visionError && <p className="ai-note bad">{visionError}</p>}
            {trained && (
              <ul className="ai-bars" data-testid="ai-prediction">
                {trained.classes.map((label) => {
                  const p = prediction?.scores.find((s) => s.label === label)?.confidence ?? 0;
                  return (
                    <li key={label} className={prediction?.label === label ? 'top' : ''}>
                      <span>{label}</span>
                      <i style={{ width: `${Math.round(p * 100)}%` }} />
                      <b>{Math.round(p * 100)} %</b>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
