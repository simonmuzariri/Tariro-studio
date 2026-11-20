/**
 * QR codes (Phase 4d): the text of a QR code the camera sees, read with jsQR (Apache-2.0).
 */
import jsQR from 'jsqr';
import type { Frame } from './colour.js';

export interface QrFound {
  text: string;
  /** Its middle and corners, in picture pixels. */
  x: number;
  y: number;
  corners: Array<{ x: number; y: number }>;
}

/** The QR code in the picture, if there is one it can read. */
export function findQrCode(frame: Frame): QrFound | undefined {
  const data = frame.data instanceof Uint8ClampedArray ? frame.data : new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  const code = jsQR(data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
  if (!code) return undefined;
  const l = code.location;
  const corners = [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner].map((p) => ({ x: p.x, y: p.y }));
  return { text: code.data, x: corners.reduce((s, p) => s + p.x, 0) / 4, y: corners.reduce((s, p) => s + p.y, 0) / 4, corners };
}
