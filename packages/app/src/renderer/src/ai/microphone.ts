import { useSyncExternalStore } from 'react';
import { bandEnergies, loudness, melFilters, soundFingerprint } from '@tariro-studio/core';

/**
 * The microphone, shared by everything that listens (teaching a sound model, the stage, the AI
 * Playground). Like the camera, the learner is asked once before it first switches on; while it is
 * on, the status bar says so. Sound stays on this computer: only its spectrum is used.
 */
export interface MicrophoneState {
  on: boolean;
  starting: boolean;
  error: string | null;
  /** 0–100, about ten times a second. */
  level: number;
}

const CONSENT_KEY = 'tariro.microphoneConsent';
/** About a second of spectra (one every 25 ms). */
const FRAMES = 40;

class Microphone {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frames: Float32Array[] = [];
  private filters: Array<Array<[number, number]>> = [];
  private spectrum = new Float32Array(0);
  private state: MicrophoneState = { on: false, starting: false, error: null, level: 0 };
  private readonly listeners = new Set<() => void>();
  private shown = 0;
  /** Shows the "may Tariro Studio use your microphone?" question (set by the app). */
  askConsent: () => Promise<boolean> = async () => false;

  get snapshot(): MicrophoneState {
    return this.state;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(change: Partial<MicrophoneState>) {
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

  async start(): Promise<boolean> {
    if (this.state.on) return true;
    if (this.state.starting) return false;
    if (!this.consented()) {
      if (!(await this.askConsent())) {
        this.set({ error: 'The microphone stays off: you chose not to use it.' });
        return false;
      }
      try {
        localStorage.setItem(CONSENT_KEY, 'yes');
      } catch {
        /* asked again next time */
      }
    }
    this.set({ starting: true, error: null });
    try {
      // The raw sound: echo cancelling and noise suppression would change what the model learns.
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      this.context = new AudioContext();
      const source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0;
      source.connect(this.analyser);
      this.filters = melFilters(this.analyser.frequencyBinCount, this.context.sampleRate);
      this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
      this.frames = [];
      this.timer = setInterval(() => this.sample(), 25);
      this.set({ on: true, starting: false });
      return true;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      this.stop();
      this.set({
        error:
          name === 'NotFoundError'
            ? 'No microphone was found. Plug one in and try again.'
            : name === 'NotAllowedError'
              ? 'The microphone was not allowed. Check that the operating system lets Tariro Studio use it.'
              : `The microphone could not start (${name || String(e)}).`,
      });
      return false;
    }
  }

  private sample() {
    if (!this.analyser) return;
    this.analyser.getFloatFrequencyData(this.spectrum);
    const bands = bandEnergies(this.spectrum, this.filters);
    this.frames.push(bands);
    if (this.frames.length > FRAMES) this.frames.shift();
    const now = performance.now();
    if (now - this.shown > 100) {
      this.shown = now;
      this.set({ level: loudness(bands) });
    }
  }

  /** The last second of sound as a fingerprint, or null until a second has been heard. */
  fingerprint(): Float32Array | null {
    return this.frames.length >= FRAMES * 0.75 ? soundFingerprint(this.frames) : null;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.analyser = null;
    this.frames = [];
    this.set({ on: false, starting: false, level: 0 });
  }
}

export const microphone = new Microphone();

export function useMicrophone(): MicrophoneState {
  return useSyncExternalStore(microphone.subscribe, () => microphone.snapshot);
}
