/**
 * Stage mode's built-in art: Tariro (the mascot, from Omorfo Tech Labs' character sheet) and
 * simple characters and backdrops drawn for Tariro Studio as SVG. Sizes are in stage units at
 * 100 % size.
 */
import { TARIRO_COSTUMES } from './tariro.js';

export interface Costume {
  id: string;
  name: string;
  /** The character this costume belongs to (the sprite library groups costumes by it). */
  character: string;
  /** Poses of one movement (walk, run…): "next costume in" cycles through a group. */
  group?: string;
  width: number;
  height: number;
  /** Drawn costumes carry their SVG… */
  svg?: string;
  /** …picture costumes name an image file that ships with the app. */
  image?: string;
}

export interface Backdrop {
  id: string;
  name: string;
  svg: string;
}

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// A friendly robot in the brand colours: round head, antenna. Costume b waves.
const tariBody = (arm: string) =>
  `<line x1="48" y1="6" x2="48" y2="18" stroke="#3d434f" stroke-width="3" stroke-linecap="round"/><circle cx="48" cy="6" r="5" fill="#e50914"/>` +
  `<rect x="22" y="18" width="52" height="40" rx="16" fill="#f4f5f7" stroke="#3d434f" stroke-width="3"/>` +
  `<rect x="30" y="28" width="36" height="18" rx="9" fill="#15171c"/><circle cx="40" cy="37" r="4.5" fill="#5ad1ff"/><circle cx="56" cy="37" r="4.5" fill="#5ad1ff"/>` +
  `<rect x="26" y="62" width="44" height="38" rx="10" fill="#e50914" stroke="#3d434f" stroke-width="3"/><circle cx="48" cy="80" r="7" fill="#f4f5f7"/>` +
  `<path d="M24 70 Q12 78 14 92" fill="none" stroke="#3d434f" stroke-width="5" stroke-linecap="round"/>` +
  arm +
  `<rect x="32" y="100" width="10" height="12" rx="3" fill="#3d434f"/><rect x="54" y="100" width="10" height="12" rx="3" fill="#3d434f"/>`;

const rocket = (flame: number) =>
  `<path d="M40 4 C58 20 62 46 58 74 L22 74 C18 46 22 20 40 4 Z" fill="#f4f5f7" stroke="#3d434f" stroke-width="3"/>` +
  `<circle cx="40" cy="38" r="9" fill="#5ad1ff" stroke="#3d434f" stroke-width="3"/>` +
  `<path d="M22 56 L8 78 L24 74 Z M58 56 L72 78 L56 74 Z" fill="#e50914" stroke="#3d434f" stroke-width="3" stroke-linejoin="round"/>` +
  `<path d="M28 76 Q40 ${76 + flame} 52 76 Z" fill="#ffb020"/><path d="M33 76 Q40 ${76 + flame * 0.6} 47 76 Z" fill="#ffe26b"/>`;

const fish = (tail: number) =>
  `<ellipse cx="44" cy="30" rx="30" ry="20" fill="#ff8a3d" stroke="#3d434f" stroke-width="3"/>` +
  `<path d="M74 30 L94 ${16 + tail} L94 ${44 - tail} Z" fill="#ff8a3d" stroke="#3d434f" stroke-width="3" stroke-linejoin="round"/>` +
  `<path d="M38 12 Q46 2 56 12" fill="#ffb37a" stroke="#3d434f" stroke-width="3"/>` +
  `<circle cx="28" cy="26" r="5" fill="#fff" stroke="#3d434f" stroke-width="2"/><circle cx="27" cy="26" r="2.5" fill="#15171c"/>` +
  `<path d="M16 36 Q22 40 28 36" fill="none" stroke="#3d434f" stroke-width="2.5" stroke-linecap="round"/>`;

const butterfly = (open: boolean) =>
  (open
    ? `<ellipse cx="22" cy="24" rx="20" ry="18" fill="#8f5cff" stroke="#3d434f" stroke-width="3"/><ellipse cx="66" cy="24" rx="20" ry="18" fill="#8f5cff" stroke="#3d434f" stroke-width="3"/>` +
      `<ellipse cx="26" cy="50" rx="14" ry="11" fill="#ff6bb5" stroke="#3d434f" stroke-width="3"/><ellipse cx="62" cy="50" rx="14" ry="11" fill="#ff6bb5" stroke="#3d434f" stroke-width="3"/>`
    : `<ellipse cx="34" cy="26" rx="10" ry="18" fill="#8f5cff" stroke="#3d434f" stroke-width="3"/><ellipse cx="54" cy="26" rx="10" ry="18" fill="#8f5cff" stroke="#3d434f" stroke-width="3"/>` +
      `<ellipse cx="36" cy="50" rx="8" ry="10" fill="#ff6bb5" stroke="#3d434f" stroke-width="3"/><ellipse cx="52" cy="50" rx="8" ry="10" fill="#ff6bb5" stroke="#3d434f" stroke-width="3"/>`) +
  `<rect x="40" y="14" width="8" height="46" rx="4" fill="#3d434f"/><path d="M42 14 Q36 4 30 4 M46 14 Q52 4 58 4" fill="none" stroke="#3d434f" stroke-width="2.5" stroke-linecap="round"/>`;

export const COSTUMES: Costume[] = [
  ...TARIRO_COSTUMES,
  { id: 'tari-a', name: 'Robot', character: 'Robot', width: 96, height: 114, svg: svg(96, 114, tariBody('<path d="M72 70 Q84 78 82 92" fill="none" stroke="#3d434f" stroke-width="5" stroke-linecap="round"/>')) },
  { id: 'tari-b', name: 'Robot waving', character: 'Robot', width: 96, height: 114, svg: svg(96, 114, tariBody('<path d="M72 70 Q86 60 86 44" fill="none" stroke="#3d434f" stroke-width="5" stroke-linecap="round"/>')) },
  { id: 'rocket-a', name: 'Rocket', character: 'Rocket', width: 80, height: 104, svg: svg(80, 104, rocket(14)) },
  { id: 'rocket-b', name: 'Rocket boost', character: 'Rocket', width: 80, height: 104, svg: svg(80, 104, rocket(26)) },
  { id: 'fish-a', name: 'Fish', character: 'Fish', width: 98, height: 54, svg: svg(98, 54, fish(0)) },
  { id: 'fish-b', name: 'Fish swish', character: 'Fish', width: 98, height: 54, svg: svg(98, 54, fish(8)) },
  { id: 'butterfly-a', name: 'Butterfly', character: 'Butterfly', width: 88, height: 64, svg: svg(88, 64, butterfly(true)) },
  { id: 'butterfly-b', name: 'Butterfly flap', character: 'Butterfly', width: 88, height: 64, svg: svg(88, 64, butterfly(false)) },
  {
    id: 'ball',
    name: 'Ball',
    character: 'Ball',
    width: 48,
    height: 48,
    svg: svg(48, 48, `<circle cx="24" cy="24" r="21" fill="#ffd166" stroke="#3d434f" stroke-width="3"/><path d="M5 20 Q24 30 43 20 M8 33 Q24 40 40 33" fill="none" stroke="#e50914" stroke-width="3"/>`),
  },
  {
    id: 'star',
    name: 'Star',
    character: 'Star',
    width: 56,
    height: 54,
    svg: svg(56, 54, `<path d="M28 3 L35 20 L53 21 L39 33 L44 51 L28 41 L12 51 L17 33 L3 21 L21 20 Z" fill="#ffd166" stroke="#3d434f" stroke-width="3" stroke-linejoin="round"/>`),
  },
  {
    id: 'apple',
    name: 'Apple',
    character: 'Apple',
    width: 50,
    height: 56,
    svg: svg(50, 56, `<path d="M25 16 C10 6 2 22 6 36 C9 48 18 54 25 50 C32 54 41 48 44 36 C48 22 40 6 25 16 Z" fill="#e5323a" stroke="#3d434f" stroke-width="3"/><path d="M25 16 Q24 8 28 3" fill="none" stroke="#3d434f" stroke-width="3" stroke-linecap="round"/><path d="M28 9 Q38 2 42 10 Q34 14 28 9 Z" fill="#3fae5a" stroke="#3d434f" stroke-width="2"/>`),
  },
  {
    id: 'paddle',
    name: 'Paddle',
    character: 'Paddle',
    width: 100,
    height: 18,
    svg: svg(100, 18, `<rect x="2" y="2" width="96" height="14" rx="7" fill="#2f8fff" stroke="#3d434f" stroke-width="3"/>`),
  },
  {
    id: 'block',
    name: 'Block',
    character: 'Block',
    width: 60,
    height: 30,
    svg: svg(60, 30, `<rect x="2" y="2" width="56" height="26" rx="4" fill="#3fae5a" stroke="#3d434f" stroke-width="3"/><path d="M8 9 H52" stroke="#ffffff70" stroke-width="3" stroke-linecap="round"/>`),
  },
];

const W = 480;
const H = 360;
const bd = (body: string) => svg(W, H, body);

export const BACKDROPS: Backdrop[] = [
  { id: 'plain', name: 'Plain', svg: bd(`<rect width="${W}" height="${H}" fill="#ffffff"/>`) },
  {
    id: 'sky',
    name: 'Sunny park',
    svg: bd(
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3ff"/><stop offset="1" stop-color="#d9f2ff"/></linearGradient></defs>` +
        `<rect width="${W}" height="${H}" fill="url(#s)"/><circle cx="400" cy="60" r="32" fill="#ffd166"/>` +
        `<ellipse cx="110" cy="70" rx="46" ry="16" fill="#fff"/><ellipse cx="140" cy="60" rx="30" ry="16" fill="#fff"/>` +
        `<path d="M0 270 Q120 240 240 268 T480 262 V360 H0 Z" fill="#6cc46b"/><path d="M0 300 Q160 282 300 302 T480 296 V360 H0 Z" fill="#4fae54"/>`,
    ),
  },
  {
    id: 'night',
    name: 'Night sky',
    svg: bd(
      `<rect width="${W}" height="${H}" fill="#101a3a"/><circle cx="380" cy="70" r="28" fill="#f4f1d8"/><circle cx="392" cy="62" r="26" fill="#101a3a"/>` +
        [
          [40, 40],
          [120, 90],
          [200, 30],
          [260, 120],
          [320, 50],
          [60, 160],
          [440, 150],
          [160, 190],
          [300, 200],
          [420, 230],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#fff"/>`)
          .join('') +
        `<path d="M0 300 L60 250 L110 290 L170 240 L240 300 L300 255 L370 300 L430 260 L480 290 V360 H0 Z" fill="#1d2b55"/>`,
    ),
  },
  {
    id: 'underwater',
    name: 'Under the sea',
    svg: bd(
      `<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fb3d6"/><stop offset="1" stop-color="#0d4f86"/></linearGradient></defs>` +
        `<rect width="${W}" height="${H}" fill="url(#w)"/><path d="M0 320 Q120 300 240 322 T480 316 V360 H0 Z" fill="#e8c97a"/>` +
        `<path d="M60 320 Q50 280 66 250 Q78 280 70 320 M400 322 Q392 270 410 240 Q420 280 412 322" fill="none" stroke="#2f9e5a" stroke-width="8" stroke-linecap="round"/>` +
        `<circle cx="300" cy="120" r="6" fill="none" stroke="#bfefff" stroke-width="2"/><circle cx="312" cy="90" r="4" fill="none" stroke="#bfefff" stroke-width="2"/>`,
    ),
  },
  {
    id: 'space',
    name: 'Space',
    svg: bd(
      `<rect width="${W}" height="${H}" fill="#07091a"/><circle cx="90" cy="280" r="60" fill="#e5603a"/><ellipse cx="90" cy="280" rx="95" ry="14" fill="none" stroke="#ffd166" stroke-width="4"/>` +
        `<circle cx="390" cy="80" r="26" fill="#5ad1ff"/>` +
        [
          [30, 30],
          [150, 60],
          [230, 140],
          [300, 40],
          [450, 200],
          [350, 300],
          [200, 320],
          [260, 250],
          [120, 150],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#fff"/>`)
          .join(''),
    ),
  },
  {
    id: 'grid',
    name: 'Coordinate grid',
    svg: bd(
      `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
        Array.from({ length: 11 }, (_, i) => `<line x1="${i * 48}" y1="0" x2="${i * 48}" y2="${H}" stroke="#e2e5ea"/>`).join('') +
        Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${i * 45}" x2="${W}" y2="${i * 45}" stroke="#e2e5ea"/>`).join('') +
        `<line x1="240" y1="0" x2="240" y2="${H}" stroke="#8b9099" stroke-width="2"/><line x1="0" y1="180" x2="${W}" y2="180" stroke="#8b9099" stroke-width="2"/>` +
        `<g font-family="sans-serif" font-size="11" fill="#6b7280"><text x="244" y="14">y 180</text><text x="244" y="354">y -180</text><text x="4" y="176">x -240</text><text x="440" y="176">x 240</text><text x="244" y="176">0</text></g>`,
    ),
  },
];

export interface SoundInfo {
  id: string;
  name: string;
  /** Length in seconds ("play sound until done" waits this long). */
  seconds: number;
}

/** Sounds are synthesised by the app (Web Audio), so there are no sound files to license. */
export const SOUNDS: SoundInfo[] = [
  { id: 'pop', name: 'pop', seconds: 0.15 },
  { id: 'beep', name: 'beep', seconds: 0.25 },
  { id: 'coin', name: 'coin', seconds: 0.35 },
  { id: 'jump', name: 'jump', seconds: 0.3 },
  { id: 'laser', name: 'laser', seconds: 0.4 },
  { id: 'drum', name: 'drum', seconds: 0.3 },
  { id: 'chime', name: 'chime', seconds: 0.9 },
  { id: 'win', name: 'win', seconds: 0.8 },
];

export const costumeById = (id: string): Costume | undefined => COSTUMES.find((c) => c.id === id);
export const backdropById = (id: string): Backdrop | undefined => BACKDROPS.find((b) => b.id === id);
/** The characters in the sprite library, each with its costumes. */
export const CHARACTERS: Array<{ name: string; costumes: string[] }> = [...new Set(COSTUMES.map((c) => c.character))].map((name) => ({
  name,
  costumes: COSTUMES.filter((c) => c.character === name).map((c) => c.id),
}));

/** The movement groups among a sprite's costumes, in order (for "next costume in"). */
export function costumeGroups(costumes: string[]): string[] {
  return [...new Set(costumes.map((id) => costumeById(id)?.group).filter((g): g is string => !!g))];
}
