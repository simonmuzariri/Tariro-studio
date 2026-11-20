import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  decodeEmbedding,
  decodeFeatures,
  encodeEmbedding,
  encodeFeatures,
  loadClassifier,
  MAX_CLASSES,
  MAX_SAMPLES_PER_CLASS,
  newImageModel,
  poseFeatures,
  POINT_SCORE,
  trainImageModel,
  trainingProblem,
  type ImageModel,
  type Pose,
  type Prediction,
} from '@tariro-studio/core';
import { Camera, LoaderCircle, Plus, Trash2, X, Zap } from '../ui/icons';
import { camera, useCamera } from './camera';
import { microphone, useMicrophone } from './microphone';
import { loadPose, type PoseEngine } from './pose';
import { loadTf } from './tf';
import { loadVision, thumbnail, type VisionEngine } from './vision';

/** What the model learns to recognise: camera pictures, sounds, or body gestures. */
export type TrainerKind = 'image' | 'sound' | 'gesture';

interface Props {
  kind?: TrainerKind;
  model: ImageModel | undefined;
  onChange(model: ImageModel): void;
  onClose(): void;
}

const TEXT: Record<TrainerKind, { title: string; intro: string; unit: string; record: string; hint: string }> = {
  image: {
    title: 'Teach the computer to see',
    intro: 'Show the camera a few examples of each thing. The pictures stay on this computer.',
    unit: 'pictures',
    record: 'Hold down to take pictures (about 8 a second). Move the object a little so the computer sees it from different sides.',
    hint: 'No pictures yet',
  },
  sound: {
    title: 'Teach the computer to hear',
    intro: 'Make each sound a few times while you hold Record. Add a "Background noise" class with nothing special going on. The sounds stay on this computer.',
    unit: 'recordings',
    record: 'Hold down while you make the sound (4 recordings a second, each of the last second of sound).',
    hint: 'No recordings yet',
  },
  gesture: {
    title: 'Teach the computer gestures',
    intro: 'Stand where the camera sees you from the waist up and hold each pose (arms up, a wave, pointing…) while you hold Record. The pictures stay on this computer.',
    unit: 'poses',
    record: 'Hold down while you hold the pose (about 8 a second). Move a little so it learns the pose, not the exact spot.',
    hint: 'No poses yet',
  },
};

/** How often a sample is taken while Record is held. */
const RECORD_MS: Record<TrainerKind, number> = { image: 120, sound: 250, gesture: 120 };

const describeAccuracy = (t: NonNullable<ImageModel['trained']>, unit: string) =>
  t.accuracy === null
    ? `Learned from ${t.samples} ${unit}. Give every class 10 or more ${unit} and it also tests itself on ${unit} it has not seen.`
    : `Learned from ${t.samples} ${unit}. On ${unit} it had not seen, it was right ${Math.round(t.accuracy * 100)} % of the time.`;

/** A new sound model starts with the background class, which every sound model needs. */
export function newModelFor(kind: TrainerKind): ImageModel {
  const m = newImageModel();
  if (kind === 'sound') m.classes[0] = { ...m.classes[0]!, name: 'Background noise' };
  return m;
}

/** The skeleton lines drawn over the camera picture for a pose. */
const BONES: Array<[number, number]> = [
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [0, 5],
  [0, 6],
];

export function drawPose(ctx: CanvasRenderingContext2D, pose: Pose, w: number, h: number, scaleX = 1, scaleY = 1): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3ddc84';
  ctx.fillStyle = '#ffffff';
  const ok = (i: number) => pose.points[i]!.score >= POINT_SCORE;
  for (const [a, b] of BONES) {
    if (!ok(a) || !ok(b)) continue;
    ctx.beginPath();
    ctx.moveTo(pose.points[a]!.x * scaleX * w, pose.points[a]!.y * scaleY * h);
    ctx.lineTo(pose.points[b]!.x * scaleX * w, pose.points[b]!.y * scaleY * h);
    ctx.stroke();
  }
  pose.points.forEach((p, i) => {
    if (!ok(i)) return;
    ctx.beginPath();
    ctx.arc(p.x * scaleX * w, p.y * scaleY * h, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * Teach the computer to recognise things, on this computer: pictures (with MobileNet features),
 * sounds (microphone fingerprints) or gestures (body poses from PoseNet). Classes, samples recorded
 * while a button is held, training, and a live preview of what the model recognises.
 */
export default function ClassifierPanel({ kind = 'image', model: given, onChange, onClose }: Props) {
  const text = TEXT[kind];
  const model = given ?? newModelFor(kind);
  const cam = useCamera();
  const mic = useMicrophone();
  const usesCamera = kind !== 'sound';
  const [vision, setVision] = useState<VisionEngine | null>(null);
  const [pose, setPose] = useState<PoseEngine | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [training, setTraining] = useState<number | null>(null);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  /** The first picture from a camera prepares the AI for its size (slow once); Record waits for it. */
  const [warm, setWarm] = useState(kind === 'sound');
  const preview = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ model, onChange });
  useLayoutEffect(() => {
    latest.current = { model, onChange };
  });
  const ready = kind === 'image' ? !!vision : kind === 'gesture' ? !!pose : true;
  /** PoseNet warms up as it loads; only the image model needs a first camera picture. */
  const isWarm = kind === 'image' ? warm : ready;
  const sourceOn = usesCamera ? cam.on : mic.on;

  // Load the engine and switch the camera or microphone on when the panel opens.
  useEffect(() => {
    let live = true;
    const fail = (e: unknown) => live && setEngineError(`The AI could not start: ${e instanceof Error ? e.message : String(e)}`);
    if (kind === 'image') loadVision().then((v) => live && setVision(v), fail);
    if (kind === 'gesture') loadPose().then((p) => live && setPose(p), fail);
    if (usesCamera && !camera.snapshot.on) void camera.start();
    if (!usesCamera && !microphone.snapshot.on) void microphone.start();
    return () => {
      live = false;
    };
  }, [kind, usesCamera]);

  // Show the shared camera picture in the preview.
  useEffect(() => {
    const host = preview.current;
    if (!host || !usesCamera) return;
    camera.video.className = 'cam-video';
    host.prepend(camera.video);
    return () => camera.video.remove();
  }, [usesCamera]);

  /** This moment's features (null when there is nothing to learn from yet). */
  const sample = (): Float32Array | null => {
    if (kind === 'sound') return microphone.fingerprint();
    if (!camera.ready) return null;
    if (kind === 'image') return vision ? vision.embed(camera.video) : null;
    if (!pose) return null;
    const p = pose.estimate(camera.video);
    return p.score > 0.25 ? poseFeatures(p) : null;
  };
  const encode = (f: Float32Array) => (kind === 'image' ? encodeEmbedding(f) : encodeFeatures(f));

  useEffect(() => {
    if (kind !== 'image' || !vision || !cam.on || warm) return;
    const t = setInterval(() => {
      if (!camera.ready) return;
      clearInterval(t);
      vision.embed(camera.video);
      setWarm(true);
    }, 100);
    return () => clearInterval(t);
  }, [kind, vision, cam.on, warm]);

  // Gestures: draw the skeleton PoseNet sees over the camera picture.
  useEffect(() => {
    if (kind !== 'gesture' || !pose || !cam.on) return;
    const t = setInterval(() => {
      const c = overlay.current;
      if (!c || !camera.ready) return;
      const p = pose.estimate(camera.video);
      const ctx = c.getContext('2d')!;
      c.width = c.clientWidth;
      c.height = c.clientHeight;
      ctx.clearRect(0, 0, c.width, c.height);
      // The preview shows the middle square of the picture (object-fit: cover), mirrored like a mirror.
      const vw = camera.video.videoWidth;
      const vh = camera.video.videoHeight;
      const side = Math.min(vw, vh);
      const scaled = { score: p.score, points: p.points.map((q) => ({ ...q, x: 1 - (q.x - (vw - side) / 2) / side, y: (q.y - (vh - side) / 2) / side })) };
      drawPose(ctx, scaled, c.width, c.height);
    }, 150);
    return () => clearInterval(t);
  }, [kind, pose, cam.on]);

  // Live recognition, about 8 times a second, once a model is trained.
  const trained = model.trained;
  useEffect(() => {
    if (!ready || !trained || !sourceOn) return;
    const classify = loadClassifier(trained);
    const t = setInterval(() => {
      const f = sample();
      setPrediction(f ? classify(f) : null);
    }, 125);
    return () => clearInterval(t);
    // `sample` reads the engines given here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, trained, sourceOn, vision, pose]);

  // Record while the button is held.
  useEffect(() => {
    if (!recording || !ready) return;
    const t = setInterval(() => {
      const { model: m, onChange: emit } = latest.current;
      const c = m.classes.find((x) => x.id === recording);
      if (!c || c.samples.length >= MAX_SAMPLES_PER_CLASS) return;
      const f = sample();
      if (!f) return;
      const thumbs = usesCamera ? [...(c.thumbs ?? []), thumbnail(camera.video)].slice(-12) : c.thumbs;
      // New samples make the old training out of date.
      emit({ classes: m.classes.map((x) => (x.id === c.id ? { ...x, samples: [...x.samples, encode(f)], ...(thumbs ? { thumbs } : {}) } : x)) });
    }, RECORD_MS[kind]);
    const stop = () => setRecording(null);
    window.addEventListener('pointerup', stop);
    return () => {
      clearInterval(t);
      window.removeEventListener('pointerup', stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, ready]);

  const edit = (classes: ImageModel['classes']) => onChange({ classes });
  const problem = trainingProblem(model, text.unit);

  const train = async () => {
    if (!ready || problem) return;
    setTrainError(null);
    setTraining(0);
    try {
      const tf = kind === 'image' && vision ? vision.tf : await loadTf();
      const t = await trainImageModel(tf, model, {
        decode: kind === 'image' ? decodeEmbedding : decodeFeatures,
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
  const sourceError = usesCamera ? cam.error : mic.error;
  const starting = usesCamera ? cam.starting : mic.starting;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal ai-panel" role="dialog" aria-label={text.title} data-testid="ai-panel" data-kind={kind}>
        <header className="ai-head">
          <h2>
            <Zap className="icon" aria-hidden="true" />
            {text.title}
          </h2>
          <p>{text.intro}</p>
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
                    {c.samples.length} {text.unit}
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
                  {c.samples.length === 0 && <span className="ai-hint">{text.hint}</span>}
                </div>
                <div className="ai-class-actions">
                  <button
                    type="button"
                    className="btn small record"
                    disabled={!ready || !sourceOn || !isWarm || c.samples.length >= MAX_SAMPLES_PER_CLASS}
                    onPointerDown={() => setRecording(c.id)}
                    data-tip={text.record}
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
            <button type="button" className="btn primary" onClick={() => void train()} disabled={!ready || !!problem || training !== null} data-tip={problem ?? 'Train the model on this computer'} data-testid="ai-train">
              {training !== null ? <LoaderCircle className="icon spin" aria-hidden="true" /> : <Zap className="icon" aria-hidden="true" />}
              {training !== null ? 'Training…' : trained ? 'Train again' : 'Train model'}
            </button>
            {training !== null && <progress max={1} value={training} data-testid="ai-progress" />}
            <p className="ai-note" data-testid="ai-train-note">
              {trainError ?? (training !== null ? `Learning from your ${text.unit}…` : trained ? describeAccuracy(trained, text.unit) : (problem ?? 'Ready to train.'))}
            </p>
          </div>

          <div className="ai-preview">
            {usesCamera ? (
              <div className="ai-video" ref={preview}>
                {kind === 'gesture' && <canvas ref={overlay} className="ai-overlay" />}
                {!cam.on && <p className="ai-video-off">{starting ? 'Starting the camera…' : (sourceError ?? 'The camera is off.')}</p>}
              </div>
            ) : (
              <div className="ai-sound" data-testid="ai-sound-level">
                <span>{mic.on ? 'Listening' : starting ? 'Starting the microphone…' : (sourceError ?? 'The microphone is off.')}</span>
                <span className="ai-level">
                  <i style={{ width: `${mic.level}%` }} />
                </span>
              </div>
            )}
            <div className="ai-cam-row">
              {usesCamera && cam.devices.length > 1 && (
                <select value={cam.deviceId ?? ''} onChange={(e) => void camera.start(e.target.value)} aria-label="Camera" data-testid="ai-camera-select">
                  {cam.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
              {usesCamera ? (
                <button type="button" className="btn small" onClick={() => (cam.on ? camera.stop() : void camera.start())} data-testid="ai-camera-toggle">
                  {cam.on ? 'Turn camera off' : 'Turn camera on'}
                </button>
              ) : (
                <button type="button" className="btn small" onClick={() => (mic.on ? microphone.stop() : void microphone.start())} data-testid="ai-microphone-toggle">
                  {mic.on ? 'Turn microphone off' : 'Turn microphone on'}
                </button>
              )}
            </div>
            {(!ready || (usesCamera && cam.on && !isWarm)) && !engineError && (
              <p className="ai-note">
                <LoaderCircle className="icon sm spin" aria-hidden="true" /> Loading the AI…
              </p>
            )}
            {engineError && <p className="ai-note bad">{engineError}</p>}
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
