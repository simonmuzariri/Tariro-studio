import { useSyncExternalStore } from 'react';

/**
 * The camera, shared by everything that uses it (training a model, the stage). The learner is
 * asked once before it is first switched on; the answer is remembered on this computer and can be
 * changed. While it is on, the status bar says so. Pictures stay on this computer.
 */
export interface CameraState {
  on: boolean;
  starting: boolean;
  deviceId: string | null;
  devices: Array<{ deviceId: string; label: string }>;
  error: string | null;
}

const CONSENT_KEY = 'tariro.cameraConsent';

class Camera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private state: CameraState = { on: false, starting: false, deviceId: null, devices: [], error: null };
  private readonly listeners = new Set<() => void>();
  /** Shows the "may Tariro Studio use your camera?" question (set by the app). */
  askConsent: () => Promise<boolean> = async () => false;

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
  }

  get snapshot(): CameraState {
    return this.state;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(change: Partial<CameraState>) {
    this.state = { ...this.state, ...change };
    for (const fn of this.listeners) fn();
  }

  private consented(): boolean {
    try {
      return localStorage.getItem(CONSENT_KEY) === 'yes';
    } catch {
      return false;
    }
  }

  /** Switch the camera on (asking first, the first time). Resolves true when it is on. */
  async start(deviceId?: string): Promise<boolean> {
    if (this.state.starting) return false;
    if (!this.consented()) {
      const yes = await this.askConsent();
      if (!yes) {
        this.set({ error: 'The camera stays off: you chose not to use it.' });
        return false;
      }
      try {
        localStorage.setItem(CONSENT_KEY, 'yes');
      } catch {
        /* asked again next time */
      }
    }
    this.set({ starting: true, error: null });
    this.stopTracks();
    try {
      const want = deviceId ?? this.state.deviceId ?? undefined;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { ...(want ? { deviceId: { exact: want } } : {}), width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      const track = stream.getVideoTracks()[0];
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      this.set({ on: true, starting: false, deviceId: track?.getSettings().deviceId ?? want ?? null, devices });
      return true;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      const message =
        name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'No camera was found. Plug one in, or choose another camera.'
          : name === 'NotAllowedError'
            ? 'The camera was not allowed. Check that no other app is using it and that the operating system lets Tariro Studio use it.'
            : name === 'NotReadableError'
              ? 'The camera is busy: another app may be using it.'
              : `The camera could not start (${name || String(e)}).`;
      this.set({ on: false, starting: false, error: message });
      return false;
    }
  }

  private stopTracks() {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  stop() {
    this.stopTracks();
    this.set({ on: false, starting: false });
  }

  /** Whether a frame is ready to read. */
  get ready(): boolean {
    return this.state.on && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }
}

export const camera = new Camera();

export function useCamera(): CameraState {
  return useSyncExternalStore(camera.subscribe, () => camera.snapshot);
}
