/**
 * Creative Studio sounds, made with Web Audio when they play (no sound files). Lengths match
 * SOUNDS in core, which "play sound until done" waits for.
 */
let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

function tone(type: OscillatorType, from: number, to: number, start: number, length: number, volume = 0.2): void {
  const a = audio();
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  const t0 = a.currentTime + start;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + length);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + length);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + length + 0.02);
}

function noise(start: number, length: number, volume = 0.3): void {
  const a = audio();
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  const gain = a.createGain();
  src.buffer = buffer;
  gain.gain.value = volume;
  src.connect(gain).connect(a.destination);
  src.start(a.currentTime + start);
}

const PLAYERS: Record<string, () => void> = {
  pop: () => tone('sine', 900, 200, 0, 0.15, 0.3),
  beep: () => tone('square', 880, 880, 0, 0.25, 0.08),
  coin: () => {
    tone('square', 988, 988, 0, 0.08, 0.08);
    tone('square', 1319, 1319, 0.08, 0.27, 0.08);
  },
  jump: () => tone('triangle', 300, 900, 0, 0.3, 0.25),
  laser: () => tone('sawtooth', 1800, 120, 0, 0.4, 0.08),
  drum: () => {
    tone('sine', 160, 40, 0, 0.3, 0.5);
    noise(0, 0.08, 0.15);
  },
  chime: () => [523, 659, 784].forEach((f, i) => tone('sine', f, f, i * 0.12, 0.65, 0.15)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, i * 0.12, 0.35, 0.15)),
};

export function playSound(id: string): void {
  try {
    PLAYERS[id]?.();
  } catch {
    /* no audio device: stay silent */
  }
}

export function playNote(midi: number, seconds: number): void {
  try {
    const f = 440 * 2 ** ((midi - 69) / 12);
    tone('triangle', f, f, 0, Math.max(seconds, 0.05), 0.2);
  } catch {
    /* no audio device */
  }
}

/** For tests: whether a sound id has a player. */
export const hasSound = (id: string) => id in PLAYERS;
