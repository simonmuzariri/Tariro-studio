/**
 * Tariro, the Tariro Studio mascot: costumes cut from the character sheet supplied by Omorfo
 * Tech Labs (docs/design/brand/tariro-character-sheet.webp, cut with
 * docs/design/tools/cut-character-sheet.py). Every full-body pose shares one canvas with the feet
 * on the same line, so switching costumes keeps her standing in place. Sizes are stage units at
 * 100 % (half the sheet's pixels); the images ship with the app (renderer assets/tariro/).
 * Generated: edit the cutting script, not this list.
 */
import type { Costume } from './art.js';

export const TARIRO_COSTUMES: Costume[] = [
  { id: 'tariro-walk-1', name: 'Walk 1', character: 'Tariro', group: 'walk', width: 93, height: 145, image: 'tariro-walk-1.webp' },
  { id: 'tariro-walk-2', name: 'Walk 2', character: 'Tariro', group: 'walk', width: 93, height: 145, image: 'tariro-walk-2.webp' },
  { id: 'tariro-walk-3', name: 'Walk 3', character: 'Tariro', group: 'walk', width: 93, height: 145, image: 'tariro-walk-3.webp' },
  { id: 'tariro-walk-4', name: 'Walk 4', character: 'Tariro', group: 'walk', width: 93, height: 145, image: 'tariro-walk-4.webp' },
  { id: 'tariro-walk-5', name: 'Walk 5', character: 'Tariro', group: 'walk', width: 93, height: 145, image: 'tariro-walk-5.webp' },
  { id: 'tariro-run-1', name: 'Run 1', character: 'Tariro', group: 'run', width: 93, height: 145, image: 'tariro-run-1.webp' },
  { id: 'tariro-run-2', name: 'Run 2', character: 'Tariro', group: 'run', width: 93, height: 145, image: 'tariro-run-2.webp' },
  { id: 'tariro-run-3', name: 'Run 3', character: 'Tariro', group: 'run', width: 93, height: 145, image: 'tariro-run-3.webp' },
  { id: 'tariro-run-4', name: 'Run 4', character: 'Tariro', group: 'run', width: 93, height: 145, image: 'tariro-run-4.webp' },
  { id: 'tariro-jump-1', name: 'Jump 1', character: 'Tariro', group: 'jump', width: 93, height: 145, image: 'tariro-jump-1.webp' },
  { id: 'tariro-jump-2', name: 'Jump 2', character: 'Tariro', group: 'jump', width: 93, height: 145, image: 'tariro-jump-2.webp' },
  { id: 'tariro-jump-3', name: 'Jump 3', character: 'Tariro', group: 'jump', width: 93, height: 145, image: 'tariro-jump-3.webp' },
  { id: 'tariro-jump-4', name: 'Jump 4', character: 'Tariro', group: 'jump', width: 93, height: 145, image: 'tariro-jump-4.webp' },
  { id: 'tariro-idle-1', name: 'Idle 1', character: 'Tariro', group: 'idle', width: 93, height: 145, image: 'tariro-idle-1.webp' },
  { id: 'tariro-idle-2', name: 'Idle 2', character: 'Tariro', group: 'idle', width: 93, height: 145, image: 'tariro-idle-2.webp' },
  { id: 'tariro-talk-1', name: 'Talk 1', character: 'Tariro', group: 'talk', width: 93, height: 145, image: 'tariro-talk-1.webp' },
  { id: 'tariro-talk-2', name: 'Talk 2', character: 'Tariro', group: 'talk', width: 93, height: 145, image: 'tariro-talk-2.webp' },
  { id: 'tariro-talk-3', name: 'Talk 3', character: 'Tariro', group: 'talk', width: 93, height: 145, image: 'tariro-talk-3.webp' },
  { id: 'tariro-talk-4', name: 'Talk 4', character: 'Tariro', group: 'talk', width: 93, height: 145, image: 'tariro-talk-4.webp' },
  { id: 'tariro-think-1', name: 'Think', character: 'Tariro', group: 'think', width: 93, height: 145, image: 'tariro-think-1.webp' },
  { id: 'tariro-point-1', name: 'Point', character: 'Tariro', group: 'point', width: 93, height: 145, image: 'tariro-point-1.webp' },
  { id: 'tariro-teach-1', name: 'Teach 1', character: 'Tariro', group: 'teach', width: 93, height: 145, image: 'tariro-teach-1.webp' },
  { id: 'tariro-teach-2', name: 'Teach 2', character: 'Tariro', group: 'teach', width: 93, height: 145, image: 'tariro-teach-2.webp' },
  { id: 'tariro-laptop-1', name: 'Laptop', character: 'Tariro', group: 'laptop', width: 93, height: 145, image: 'tariro-laptop-1.webp' },
  { id: 'tariro-celebrate-1', name: 'Celebrate 1', character: 'Tariro', group: 'celebrate', width: 93, height: 145, image: 'tariro-celebrate-1.webp' },
  { id: 'tariro-celebrate-2', name: 'Celebrate 2', character: 'Tariro', group: 'celebrate', width: 93, height: 145, image: 'tariro-celebrate-2.webp' },
  { id: 'tariro-sad-1', name: 'Sad', character: 'Tariro', group: 'sad', width: 93, height: 145, image: 'tariro-sad-1.webp' },
  { id: 'tariro-crouch-1', name: 'Crouch', character: 'Tariro', group: 'crouch', width: 93, height: 145, image: 'tariro-crouch-1.webp' },
  { id: 'tariro-fall-1', name: 'Fall 1', character: 'Tariro', group: 'fall', width: 93, height: 145, image: 'tariro-fall-1.webp' },
  { id: 'tariro-fall-2', name: 'Fall 2', character: 'Tariro', group: 'fall', width: 93, height: 145, image: 'tariro-fall-2.webp' },
  { id: 'tariro-getup-1', name: 'Get up 1', character: 'Tariro', group: 'getup', width: 93, height: 145, image: 'tariro-getup-1.webp' },
  { id: 'tariro-getup-2', name: 'Get up 2', character: 'Tariro', group: 'getup', width: 93, height: 145, image: 'tariro-getup-2.webp' },
  { id: 'tariro-wave-1', name: 'Wave 1', character: 'Tariro', group: 'wave', width: 93, height: 145, image: 'tariro-wave-1.webp' },
  { id: 'tariro-wave-2', name: 'Wave 2', character: 'Tariro', group: 'wave', width: 93, height: 145, image: 'tariro-wave-2.webp' },
  { id: 'tariro-face-1', name: 'Face 1', character: 'Tariro face', group: 'face', width: 56, height: 72, image: 'tariro-face-1.webp' },
  { id: 'tariro-face-2', name: 'Face 2', character: 'Tariro face', group: 'face', width: 56, height: 72, image: 'tariro-face-2.webp' },
  { id: 'tariro-face-3', name: 'Face 3', character: 'Tariro face', group: 'face', width: 56, height: 72, image: 'tariro-face-3.webp' },
  { id: 'tariro-face-4', name: 'Face 4', character: 'Tariro face', group: 'face', width: 56, height: 72, image: 'tariro-face-4.webp' },
  { id: 'tariro-face-5', name: 'Face 5', character: 'Tariro face', group: 'face', width: 56, height: 72, image: 'tariro-face-5.webp' },
  { id: 'tariro-face-6', name: 'Face 6', character: 'Tariro face', group: 'face', width: 56, height: 72, image: 'tariro-face-6.webp' },
  { id: 'tariro-face-7', name: 'Face 7', character: 'Tariro face', group: 'face', width: 56, height: 72, image: 'tariro-face-7.webp' },
  { id: 'tariro-face-8', name: 'Face 8', character: 'Tariro face', group: 'face', width: 56, height: 72, image: 'tariro-face-8.webp' },
];
