import { loadClassifier, POINT_SCORE, poseFeatures, type ColourName, type Prediction, type StageBoardHandler, type TrainedModel } from '@tariro-studio/core';
import { camera } from '../ai/camera';
import { Detectors } from '../ai/detect';
import { microphone } from '../ai/microphone';
import { loadVision } from '../ai/vision';

/** What a stage's AI blocks need started (from the block types its scripts use). */
export interface AiNeeds {
  image: boolean;
  colours: boolean;
  markers: boolean;
  qr: boolean;
  pose: boolean;
  gesture: boolean;
  sound: boolean;
}

export function aiNeeds(workspaces: unknown[]): AiNeeds {
  const json = JSON.stringify(workspaces);
  const has = (re: RegExp) => re.test(json);
  return {
    image: has(/"type":"ai_(when|is|label|confidence|video)"/),
    colours: has(/"type":"ai_colour_/),
    markers: has(/"type":"ai_marker_/),
    qr: has(/"type":"ai_qr_/),
    pose: has(/"type":"ai_(pose_|body_)/),
    gesture: has(/"type":"ai_gesture/),
    sound: has(/"type":"ai_(sound|loudness)/),
  };
}

/** How sure the model must be before the stage treats its answer as "seen". */
export const SEEN_CONFIDENCE = 0.6;

export type VideoMode = 'off' | 'on' | 'flipped';

/**
 * The AI while a Stage program runs: the camera, and the trained model naming what it sees about
 * eight times a second. Blocks read the latest answer, so they never wait.
 */
export class AiSession {
  prediction: Prediction | null = null;
  video: VideoMode = 'off';
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedCamera = false;
  private stopped = false;
  /** When the model last named a camera picture (performance.now()). */
  private lastAt = 0;
  /** Without a fresh answer for this long, the AI counts as not seeing anything (fail-safe). */
  static readonly STALE_MS = 1000;

  /** Colours, markers, QR codes and pose (for the blocks that use them). */
  detectors: Detectors | null = null;
  gesture: Prediction | null = null;
  sound: Prediction | null = null;
  private gestureTimer: ReturnType<typeof setInterval> | null = null;
  private soundTimer: ReturnType<typeof setInterval> | null = null;
  private startedMic = false;

  constructor(
    private readonly model: TrainedModel | undefined,
    private readonly report: (message: string) => void,
    private readonly needs: AiNeeds = { image: true, colours: false, markers: false, qr: false, pose: false, gesture: false, sound: false },
    private readonly models: { gesture?: TrainedModel | undefined; sound?: TrainedModel | undefined } = {},
  ) {}

  /** Start the camera (and the microphone) and the recognition the blocks need. */
  async start(): Promise<void> {
    const n = this.needs;
    if (n.sound) void this.startSound();
    const usesCamera = n.image || n.colours || n.markers || n.qr || n.pose || n.gesture;
    if (!usesCamera) return;
    if (n.colours || n.markers || n.qr || n.pose || n.gesture) {
      this.detectors = new Detectors({ colours: n.colours, markers: n.markers, qr: n.qr, pose: n.pose || n.gesture }, this.report);
      this.detectors.start();
      if (n.gesture && this.models.gesture) {
        const classify = loadClassifier(this.models.gesture);
        this.gestureTimer = setInterval(() => {
          const pose = this.detectors?.latest.pose;
          const v = camera.video;
          // The gesture model learned from poses in camera pixels: back from fractions to pixels.
          this.gesture = pose ? classify(poseFeatures({ score: pose.score, points: pose.points.map((p) => ({ ...p, x: p.x * v.videoWidth, y: p.y * v.videoHeight })) })) : null;
        }, 150);
      }
    }
    if (!camera.snapshot.on) {
      this.startedCamera = await camera.start();
      if (!this.startedCamera) {
        this.report(camera.snapshot.error ?? 'The camera is off.');
        return;
      }
    }
    if (this.stopped || !this.model || !n.image) return;
    try {
      const vision = await loadVision();
      if (this.stopped) return;
      const classify = loadClassifier(this.model);
      this.timer = setInterval(() => {
        if (!camera.ready) return;
        this.prediction = classify(vision.embed(camera.video));
        this.lastAt = performance.now();
      }, 125);
    } catch (e) {
      this.report(`The AI could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** True when recognition is running but no answer has come for a while (camera off or stuck). */
  get stalled(): boolean {
    return this.timer !== null && this.lastAt > 0 && performance.now() - this.lastAt > AiSession.STALE_MS;
  }

  /** The class it sees now ('' when it is not sure, has no fresh answer, or there is no model). */
  get label(): string {
    if (this.stalled) return '';
    return this.prediction && this.prediction.confidence >= SEEN_CONFIDENCE ? this.prediction.label : '';
  }

  confidence(label: string): number {
    if (this.stalled) return 0;
    return this.prediction?.scores.find((s) => s.label === label)?.confidence ?? 0;
  }

  private async startSound(): Promise<void> {
    if (!microphone.snapshot.on) {
      this.startedMic = await microphone.start();
      if (!this.startedMic) {
        this.report(microphone.snapshot.error ?? 'The microphone is off.');
        return;
      }
    }
    if (this.stopped || !this.models.sound) return;
    const classify = loadClassifier(this.models.sound);
    this.soundTimer = setInterval(() => {
      const f = microphone.fingerprint();
      this.sound = f ? classify(f) : null;
    }, 250);
  }

  /** A gesture or sound class, when its model is at least 60 % sure ('' otherwise). */
  heard(p: Prediction | null): string {
    return p && p.confidence >= SEEN_CONFIDENCE ? p.label : '';
  }

  /** A position in the camera picture (fractions) on the stage (−240…240, −180…180), mirrored when the video is. */
  stageX(fx: number): number {
    const x = (fx - 0.5) * 480;
    return Math.round(this.video === 'flipped' ? -x : x);
  }
  stageY(fy: number): number {
    return Math.round((0.5 - fy) * 360);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.gestureTimer) clearInterval(this.gestureTimer);
    if (this.soundTimer) clearInterval(this.soundTimer);
    this.detectors?.stop();
    if (this.startedMic) microphone.stop();
    // Only switch the camera off if this run switched it on.
    if (this.startedCamera) camera.stop();
  }
}

/** The AI Vision blocks on the stage. */
export function aiStageHandlers(session: () => AiSession | null): Record<string, StageBoardHandler> {
  return {
    ai_video: {
      kind: 'statement',
      run: (ctx) => {
        const s = session();
        if (s) s.video = (['off', 'on', 'flipped'] as const).find((m) => m === ctx.field('MODE').toLowerCase()) ?? 'on';
      },
    },
    ai_label: { kind: 'value', run: () => session()?.label ?? '' },
    ai_confidence: { kind: 'value', run: (ctx) => Math.round((session()?.confidence(ctx.field('CLASS')) ?? 0) * 100) },
    ai_is: { kind: 'value', run: (ctx) => (session()?.label ?? '') === ctx.field('CLASS') },

    // Colours (4d): positions on the stage, size in percent of the picture.
    ai_colour_seen: { kind: 'value', run: (ctx) => !!colour(session(), ctx.field('COLOUR'))?.seen },
    ai_colour_x: { kind: 'value', run: (ctx) => ifSeen(session(), colour(session(), ctx.field('COLOUR')), (s, c) => s.stageX(c.x)) },
    ai_colour_y: { kind: 'value', run: (ctx) => ifSeen(session(), colour(session(), ctx.field('COLOUR')), (s, c) => s.stageY(c.y)) },
    ai_colour_size: { kind: 'value', run: (ctx) => Math.round((colour(session(), ctx.field('COLOUR'))?.area ?? 0) * 1000) / 10 },
    // ArUco markers (4d).
    ai_marker_seen: { kind: 'value', run: (ctx) => !!marker(session(), ctx.number('ID')) },
    ai_marker_x: { kind: 'value', run: (ctx) => ifSeen(session(), marker(session(), ctx.number('ID')), (s, m) => s.stageX(m.x)) },
    ai_marker_y: { kind: 'value', run: (ctx) => ifSeen(session(), marker(session(), ctx.number('ID')), (s, m) => s.stageY(m.y)) },
    ai_marker_number: { kind: 'value', run: () => session()?.detectors?.latest.markers[0]?.id ?? -1 },
    // QR codes (4d).
    ai_qr_text: { kind: 'value', run: () => session()?.detectors?.latest.qr?.text ?? '' },
    // Body pose and gestures (4f).
    ai_body_seen: { kind: 'value', run: () => !!session()?.detectors?.latest.pose },
    ai_pose_x: { kind: 'value', run: (ctx) => ifSeen(session(), posePoint(session(), ctx.field('POINT')), (s, p) => s.stageX(p.x)) },
    ai_pose_y: { kind: 'value', run: (ctx) => ifSeen(session(), posePoint(session(), ctx.field('POINT')), (s, p) => s.stageY(p.y)) },
    ai_gesture: { kind: 'value', run: () => session()?.heard(session()!.gesture) ?? '' },
    ai_gesture_is: { kind: 'value', run: (ctx) => (session()?.heard(session()!.gesture) ?? '') === ctx.field('CLASS') },
    // Sounds (4f).
    ai_sound: { kind: 'value', run: () => session()?.heard(session()!.sound) ?? '' },
    ai_sound_is: { kind: 'value', run: (ctx) => (session()?.heard(session()!.sound) ?? '') === ctx.field('CLASS') },
    ai_loudness: { kind: 'value', run: () => microphone.snapshot.level },
  };
}

const colour = (s: AiSession | null, name: string) => s?.detectors?.latest.colours[name as ColourName];
const marker = (s: AiSession | null, id: number) => s?.detectors?.latest.markers.find((m) => m.id === Math.round(id));
const posePoint = (s: AiSession | null, name: string) => {
  const p = s?.detectors?.latest.pose?.points.find((q) => q.name === name);
  return p && p.score >= POINT_SCORE ? p : undefined;
};
/** A position only when the thing is seen; 0 (the middle of the stage) otherwise. */
function ifSeen<T>(s: AiSession | null, thing: T | undefined, at: (s: AiSession, t: T) => number): number {
  return s && thing && (thing as { seen?: boolean }).seen !== false ? at(s, thing) : 0;
}

/** Whether a stage uses any AI Vision block (then the camera starts with the green flag). */
export const usesAi = (workspaces: unknown[]): boolean => JSON.stringify(workspaces).includes('"type":"ai_');
