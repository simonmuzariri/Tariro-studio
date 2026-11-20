import { useEffect, useRef, useState } from 'react';
import { arucoSvg, COLOUR_NAMES, loadClassifier, poseFeatures, type ColourName, type ImageModel, type Prediction } from '@tariro-studio/core';
import { X, Zap } from '../ui/icons';
import { camera, useCamera } from './camera';
import { drawPose } from './ClassifierPanel';
import { Detectors, type Detections } from './detect';
import { microphone, useMicrophone } from './microphone';
import { loadVision } from './vision';

interface Props {
  ai?: ImageModel | undefined;
  gesture?: ImageModel | undefined;
  sound?: ImageModel | undefined;
  onClose(): void;
}

type Switch = 'image' | 'colours' | 'markers' | 'qr' | 'pose' | 'gesture' | 'sound';

/** Overlay colours for the colour boxes (what each detected colour is drawn in). */
const SWATCH: Record<ColourName, string> = { red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047', blue: '#1e88e5', purple: '#8e24aa', pink: '#ec407a', white: '#ffffff', black: '#212121' };

/**
 * The AI Playground (4e): every recogniser at once on the live camera (and the microphone), with
 * what each one finds drawn over the picture, so a learner can see what the AI sees before using
 * it in a program. Nothing is recorded.
 */
export default function Playground({ ai, gesture, sound, onClose }: Props) {
  const cam = useCamera();
  const mic = useMicrophone();
  const [on, setOn] = useState<Record<Switch, boolean>>({ image: !!ai?.trained, colours: true, markers: true, qr: true, pose: false, gesture: false, sound: false });
  const [mirror, setMirror] = useState(true);
  const [found, setFound] = useState<Detections | null>(null);
  const [imageSays, setImageSays] = useState<Prediction | null>(null);
  const [gestureSays, setGestureSays] = useState<Prediction | null>(null);
  const [soundSays, setSoundSays] = useState<Prediction | null>(null);
  const [sheet, setSheet] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const detectors = useRef<Detectors | null>(null);

  // The camera (and the detectors) while the Playground is open.
  useEffect(() => {
    if (!camera.snapshot.on) void camera.start();
    const d = new Detectors({});
    detectors.current = d;
    d.start();
    return () => d.stop();
  }, []);
  useEffect(() => {
    detectors.current?.set({ colours: on.colours, markers: on.markers, qr: on.qr, pose: on.pose || on.gesture });
  }, [on]);
  useEffect(() => {
    const h = host.current;
    if (!h) return;
    camera.video.className = `pg-video${mirror ? ' mirrored' : ''}`;
    h.prepend(camera.video);
    return () => camera.video.remove();
  }, [mirror]);

  // The image model, gesture model and sound model, when switched on and trained.
  useEffect(() => {
    if (!on.image || !ai?.trained) return;
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const classify = loadClassifier(ai.trained);
    void loadVision().then((v) => {
      if (!live) return;
      timer = setInterval(() => camera.ready && setImageSays(classify(v.embed(camera.video))), 200);
    });
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [on.image, ai?.trained]);
  useEffect(() => {
    if (!on.gesture || !gesture?.trained) return;
    const classify = loadClassifier(gesture.trained);
    const t = setInterval(() => {
      const p = detectors.current?.latest.pose;
      const v = camera.video;
      setGestureSays(p ? classify(poseFeatures({ score: p.score, points: p.points.map((q) => ({ ...q, x: q.x * v.videoWidth, y: q.y * v.videoHeight })) })) : null);
    }, 200);
    return () => clearInterval(t);
  }, [on.gesture, gesture?.trained]);
  useEffect(() => {
    if (!on.sound) return;
    let started = false;
    void microphone.start().then((ok) => (started = ok));
    const classify = sound?.trained ? loadClassifier(sound.trained) : null;
    const t = setInterval(() => {
      const f = microphone.fingerprint();
      setSoundSays(classify && f ? classify(f) : null);
    }, 250);
    return () => {
      clearInterval(t);
      if (started) microphone.stop();
    };
  }, [on.sound, sound?.trained]);

  // Draw what the detectors find over the picture, five times a second.
  useEffect(() => {
    const t = setInterval(() => {
      const d = detectors.current?.latest ?? null;
      setFound(d);
      const c = overlay.current;
      if (!c || !d) return;
      c.width = c.clientWidth;
      c.height = c.clientHeight;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      const W = c.width;
      const H = c.height;
      const X = (fx: number) => (mirror ? 1 - fx : fx) * W;
      const Y = (fy: number) => fy * H;
      ctx.font = 'bold 14px Nunito, sans-serif';
      ctx.lineWidth = 3;
      for (const [name, col] of Object.entries(d.colours) as Array<[ColourName, NonNullable<Detections['colours'][ColourName]>]>) {
        if (!col.seen || name === 'white' || name === 'black') continue;
        const x0 = X(col.box.x);
        const x1 = X(col.box.x + col.box.width);
        ctx.strokeStyle = SWATCH[name];
        ctx.strokeRect(Math.min(x0, x1), Y(col.box.y), Math.abs(x1 - x0), col.box.height * H);
        // The name on a dark tag, so it shows on top of its own colour.
        const tagW = ctx.measureText(name).width + 8;
        ctx.fillStyle = '#000000b0';
        ctx.fillRect(Math.min(x0, x1), Y(col.box.y), tagW, 20);
        ctx.fillStyle = SWATCH[name];
        ctx.fillText(name, Math.min(x0, x1) + 4, Y(col.box.y) + 15);
      }
      for (const m of d.markers) {
        ctx.strokeStyle = '#00e5ff';
        ctx.beginPath();
        m.corners.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = '#00e5ff';
        ctx.fillText(`marker ${m.id}`, X(m.x) - 30, Y(m.y) + 5);
      }
      if (d.qr) {
        ctx.strokeStyle = '#ffd400';
        ctx.beginPath();
        d.qr.corners.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = '#ffd400';
        ctx.fillText(d.qr.text.slice(0, 40), X(d.qr.corners[0]!.x), Y(d.qr.corners[0]!.y) - 6);
      }
      if (d.pose) drawPose(ctx, { score: d.pose.score, points: d.pose.points.map((p) => ({ ...p, x: mirror ? 1 - p.x : p.x })) }, W, H);
    }, 200);
    return () => clearInterval(t);
  }, [mirror]);

  const toggle = (k: Switch) => setOn((o) => ({ ...o, [k]: !o[k] }));
  const seenColours = COLOUR_NAMES.filter((c) => found?.colours[c]?.seen);
  const sw = (k: Switch, label: string, disabled = false, note?: string) => (
    <label className={`check pg-switch${disabled ? ' off' : ''}`} data-tip={note}>
      <input type="checkbox" checked={on[k] && !disabled} disabled={disabled} onChange={() => toggle(k)} data-testid={`pg-${k}`} />
      {label}
    </label>
  );
  const says = (p: Prediction | null) => (p ? `${p.label} (${Math.round(p.confidence * 100)} %)` : '…');

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal pg" role="dialog" aria-label="AI Playground" data-testid="ai-playground">
        <header className="ai-head">
          <h2>
            <Zap className="icon" aria-hidden="true" />
            AI Playground
          </h2>
          <p>See what each AI tool finds in the camera picture (and hears), before you use it in a program. Nothing is recorded.</p>
          <button type="button" className="btn ghost icon-only" onClick={onClose} aria-label="Close" data-testid="pg-close">
            <X className="icon" />
          </button>
        </header>
        <div className="pg-body">
          <div className="pg-view" ref={host}>
            <canvas ref={overlay} className="pg-overlay" />
            {!cam.on && <p className="ai-video-off">{cam.starting ? 'Starting the camera…' : (cam.error ?? 'The camera is off.')}</p>}
          </div>
          <div className="pg-side">
            <fieldset>
              <legend>Show</legend>
              {sw('image', 'Image model', !ai?.trained, ai?.trained ? undefined : 'Train an image model first (Teach AI)')}
              {sw('colours', 'Colours')}
              {sw('markers', 'ArUco markers')}
              {sw('qr', 'QR codes')}
              {sw('pose', 'Body pose')}
              {sw('gesture', 'Gestures', !gesture?.trained, gesture?.trained ? undefined : 'Teach gestures first')}
              {sw('sound', 'Sounds')}
              <label className="check pg-switch">
                <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
                Mirror the picture
              </label>
            </fieldset>
            <dl className="pg-readout" data-testid="pg-readout">
              {on.image && ai?.trained && (
                <div>
                  <dt>Image model</dt>
                  <dd>{says(imageSays)}</dd>
                </div>
              )}
              {on.colours && (
                <div>
                  <dt>Colours</dt>
                  <dd data-testid="pg-colours-seen">{seenColours.length ? seenColours.map((c) => `${c} ${Math.round((found!.colours[c]!.area ?? 0) * 100)} %`).join(', ') : 'none'}</dd>
                </div>
              )}
              {on.markers && (
                <div>
                  <dt>Markers</dt>
                  <dd data-testid="pg-markers-seen">{found?.markers.length ? found.markers.map((m) => m.id).join(', ') : 'none'}</dd>
                </div>
              )}
              {on.qr && (
                <div>
                  <dt>QR code</dt>
                  <dd data-testid="pg-qr-seen">{found?.qr?.text ?? 'none'}</dd>
                </div>
              )}
              {(on.pose || on.gesture) && (
                <div>
                  <dt>Body</dt>
                  <dd data-testid="pg-pose-seen">{found?.pose ? `seen (${Math.round(found.pose.score * 100)} %)` : 'not seen'}</dd>
                </div>
              )}
              {on.gesture && gesture?.trained && (
                <div>
                  <dt>Gesture</dt>
                  <dd>{says(gestureSays)}</dd>
                </div>
              )}
              {on.sound && (
                <div>
                  <dt>Sound</dt>
                  <dd>
                    <span className="ai-level">
                      <i style={{ width: `${mic.level}%` }} />
                    </span>{' '}
                    {sound?.trained ? says(soundSays) : mic.on ? 'listening (teach sounds to name them)' : (mic.error ?? 'starting…')}
                  </dd>
                </div>
              )}
            </dl>
            <button type="button" className="btn small" onClick={() => setSheet(true)} data-testid="pg-print-markers">
              Print markers…
            </button>
          </div>
        </div>
      </section>
      {sheet && <MarkerSheet onClose={() => setSheet(false)} />}
    </div>
  );
}

/** Markers 0–11 to print (cut them out; keep the white margin round each). */
function MarkerSheet({ onClose }: { onClose(): void }) {
  const ids = Array.from({ length: 12 }, (_, i) => i);
  return (
    <div className="modal-backdrop marker-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal marker-sheet" role="dialog" aria-label="ArUco markers to print" data-testid="marker-sheet">
        <header className="marker-sheet-head">
          <h2>ArUco markers 0–11</h2>
          <p>Print this page, cut the markers out with their white margin, and hold one up to the camera. Bigger prints are seen from further away.</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn primary" onClick={() => window.print()} data-testid="marker-print">
              Print
            </button>
          </div>
        </header>
        <div className="marker-grid">
          {ids.map((id) => (
            <figure key={id}>
              {/* Our own SVG, made from the marker's bits: safe to place as markup. */}
              <span dangerouslySetInnerHTML={{ __html: arucoSvg(id, 160) }} />
              <figcaption>Marker {id}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
