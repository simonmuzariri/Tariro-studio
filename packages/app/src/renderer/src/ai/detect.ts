/**
 * The camera detectors (4d, 4f): colours, ArUco markers, QR codes and body pose, run on the shared
 * camera's picture a few times a second. Positions are given as fractions of the picture (0–1,
 * from the top-left), so the stage, the AI Playground's overlay and the tests all read them alike.
 */
import { findArucoMarkers, findColours, findQrCode, type ColourFound, type ColourName, type Pose } from '@tariro-studio/core';
import { camera } from './camera';
import { loadPose, type PoseEngine } from './pose';

export interface Spot {
  x: number;
  y: number;
}
export interface Detections {
  /** When these were found (performance.now()). */
  at: number;
  colours: Partial<Record<ColourName, ColourFound & { box: { x: number; y: number; width: number; height: number } }>>;
  markers: Array<{ id: number; x: number; y: number; size: number; corners: Spot[] }>;
  qr: { text: string; x: number; y: number; corners: Spot[] } | null;
  /** Body points as fractions of the picture, or null when no body is seen. */
  pose: Pose | null;
}

export interface DetectorChoice {
  colours?: boolean;
  markers?: boolean;
  qr?: boolean;
  pose?: boolean;
}

/** The picture the detectors look at: small enough to be quick, big enough for a marker across a room. */
const W = 320;
const H = 240;

export class Detectors {
  latest: Detections = { at: 0, colours: {}, markers: [], qr: null, pose: null };
  private timer: ReturnType<typeof setInterval> | null = null;
  private canvas = document.createElement('canvas');
  private pose: PoseEngine | null = null;
  private poseError: string | null = null;
  private busy = false;

  constructor(
    private choice: DetectorChoice,
    private readonly report?: (message: string) => void,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
  }

  /** Which detectors run (the Playground's switches). */
  set(choice: DetectorChoice): void {
    this.choice = choice;
    if (choice.pose) void this.loadPose();
  }

  private async loadPose() {
    if (this.pose || this.poseError) return;
    try {
      this.pose = await loadPose();
    } catch (e) {
      this.poseError = `Body pose could not start: ${e instanceof Error ? e.message : String(e)}`;
      this.report?.(this.poseError);
    }
  }

  start(): void {
    if (this.timer) return;
    if (this.choice.pose) void this.loadPose();
    this.timer = setInterval(() => this.run(), 150);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private run(): void {
    if (this.busy || !camera.ready) return;
    this.busy = true;
    try {
      const v = camera.video;
      const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, W, H);
      const frame = { width: W, height: H, data: ctx.getImageData(0, 0, W, H).data };
      const out: Detections = { at: performance.now(), colours: {}, markers: [], qr: null, pose: null };
      const fx = (x: number) => x / W;
      const fy = (y: number) => y / H;
      if (this.choice.colours) {
        const all = findColours(frame);
        for (const [name, c] of Object.entries(all) as Array<[ColourName, ColourFound]>)
          out.colours[name] = { ...c, x: fx(c.x), y: fy(c.y), box: { x: fx(c.box.x), y: fy(c.box.y), width: fx(c.box.width), height: fy(c.box.height) } };
      }
      if (this.choice.markers)
        out.markers = findArucoMarkers(frame).map((m) => ({ id: m.id, x: fx(m.x), y: fy(m.y), size: m.size / W, corners: m.corners.map((p) => ({ x: fx(p.x), y: fy(p.y) })) }));
      if (this.choice.qr) {
        const q = findQrCode(frame);
        out.qr = q ? { text: q.text, x: fx(q.x), y: fy(q.y), corners: q.corners.map((p) => ({ x: fx(p.x), y: fy(p.y) })) } : null;
      }
      if (this.choice.pose && this.pose) {
        const p = this.pose.estimate(v);
        const vw = v.videoWidth || W;
        const vh = v.videoHeight || H;
        out.pose = p.score > 0.2 ? { score: p.score, points: p.points.map((q) => ({ ...q, x: q.x / vw, y: q.y / vh })) } : null;
      }
      this.latest = out;
    } finally {
      this.busy = false;
    }
  }
}
