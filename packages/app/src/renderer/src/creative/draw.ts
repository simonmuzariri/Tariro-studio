import { BACKDROPS, COSTUMES, STAGE_HEIGHT, STAGE_WIDTH, costumeById, type StageView } from '@tariro-studio/core';

/** Picture costumes (Tariro) ship with the app as image files. */
const PICTURES = import.meta.glob<string>('../assets/tariro/*.webp', { eager: true, query: '?url', import: 'default' });
const pictureUrl = (file: string) => PICTURES[`../assets/tariro/${file}`];

/** The image source of a costume or backdrop: its bundled picture, or its SVG as a data URL. */
export function artSrc(art: { svg?: string; image?: string }): string {
  if (art.image) return pictureUrl(art.image) ?? '';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(art.svg ?? '')}`;
}

/** Every costume and backdrop as an image, made once. */
const images = new Map<string, HTMLImageElement>();
export function artImage(id: string): HTMLImageElement | undefined {
  let img = images.get(id);
  if (!img) {
    const art = COSTUMES.find((c) => c.id === id) ?? BACKDROPS.find((b) => b.id === id);
    if (!art) return undefined;
    img = new Image();
    img.src = artSrc(art);
    images.set(id, img);
  }
  return img;
}

/** Resolves once every art image has loaded (the first frame then draws complete). */
export function loadAllArt(): Promise<void> {
  const all = [...COSTUMES.map((c) => c.id), ...BACKDROPS.map((b) => b.id)].map((id) => artImage(id)!);
  return Promise.all(all.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)))).then(() => undefined);
}

function bubble(g: CanvasRenderingContext2D, text: string, think: boolean, x: number, top: number): void {
  g.font = '700 13.5px "Nunito Variable", Nunito, system-ui, sans-serif';
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > 160 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 5);
  const width = Math.max(40, ...shown.map((l) => g.measureText(l).width)) + 20;
  const height = shown.length * 17 + 14;
  // Keep the bubble on the stage.
  const left = Math.min(Math.max(x - 10, 4), STAGE_WIDTH - width - 4);
  const y = Math.max(top - height - 14, 4);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#8b9099';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(left, y, width, height, 12);
  g.fill();
  g.stroke();
  if (think) {
    for (const [dx, dy, r] of [
      [16, height + 6, 4],
      [8, height + 14, 2.5],
    ] as const) {
      g.beginPath();
      g.arc(left + dx, y + dy, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  } else {
    g.beginPath();
    g.moveTo(left + 14, y + height - 1);
    g.lineTo(left + 10, y + height + 10);
    g.lineTo(left + 26, y + height - 1);
    g.fill();
    g.stroke();
  }
  g.fillStyle = '#15171c';
  g.textBaseline = 'top';
  shown.forEach((l, i) => g.fillText(l, left + 10, y + 8 + i * 17));
}

/**
 * Draw one frame. The canvas is STAGE_WIDTH × STAGE_HEIGHT stage units (scaled by `scale` for
 * sharp pixels); stage (0, 0) is the centre with y up.
 */
export function drawStage(canvas: HTMLCanvasElement, view: StageView, opts: { selected?: string | null; scale: number; video?: { el: HTMLVideoElement; flipped: boolean } | null }): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(opts.scale, 0, 0, opts.scale, 0, 0);
  g.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  const bd = artImage(view.backdrop);
  if (bd?.complete) g.drawImage(bd, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  else {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  }
  // The camera picture, behind the sprites (like a mirror unless "flipped" is chosen).
  const v = opts.video?.el;
  if (v && v.videoWidth > 0) {
    const scale = Math.max(STAGE_WIDTH / v.videoWidth, STAGE_HEIGHT / v.videoHeight);
    const w = v.videoWidth * scale;
    const h = v.videoHeight * scale;
    g.save();
    if (!opts.video!.flipped) {
      g.translate(STAGE_WIDTH, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, (STAGE_WIDTH - w) / 2, (STAGE_HEIGHT - h) / 2, w, h);
    g.restore();
  }
  const bubbles: Array<() => void> = [];
  for (const s of view.sprites) {
    const c = costumeById(s.costume);
    const img = artImage(s.costume);
    if (!c || !img?.complete) continue;
    const k = s.size / 100;
    const cx = STAGE_WIDTH / 2 + s.x;
    const cy = STAGE_HEIGHT / 2 - s.y;
    if (s.visible) {
      g.save();
      g.translate(cx, cy);
      g.rotate(((s.direction - 90) * Math.PI) / 180);
      g.drawImage(img, (-c.width * k) / 2, (-c.height * k) / 2, c.width * k, c.height * k);
      g.restore();
    }
    if (opts.selected === s.id) {
      g.save();
      g.setLineDash([5, 4]);
      g.strokeStyle = '#e50914';
      g.lineWidth = 1.5;
      g.strokeRect(cx - (c.width * k) / 2 - 3, cy - (c.height * k) / 2 - 3, c.width * k + 6, c.height * k + 6);
      g.restore();
    }
    if (s.say && s.visible) {
      const say = s.say;
      bubbles.push(() => bubble(g, say.text, say.think, cx + (c.width * k) / 4, cy - (c.height * k) / 2));
    }
  }
  // Speech bubbles go on top of every sprite.
  bubbles.forEach((b) => b());
}
