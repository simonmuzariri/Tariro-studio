import { loadClassifier, type Prediction, type StageBoardHandler, type TrainedModel } from '@tariro-studio/core';
import { camera } from '../ai/camera';
import { loadVision } from '../ai/vision';

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

  constructor(
    private readonly model: TrainedModel | undefined,
    private readonly report: (message: string) => void,
  ) {}

  /** Start the camera and, when there is a model, recognition. */
  async start(): Promise<void> {
    if (!camera.snapshot.on) {
      this.startedCamera = await camera.start();
      if (!this.startedCamera) {
        this.report(camera.snapshot.error ?? 'The camera is off.');
        return;
      }
    }
    if (this.stopped || !this.model) return;
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

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
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
  };
}

/** Whether a stage uses any AI Vision block (then the camera starts with the green flag). */
export const usesAi = (workspaces: unknown[]): boolean => JSON.stringify(workspaces).includes('"type":"ai_');
