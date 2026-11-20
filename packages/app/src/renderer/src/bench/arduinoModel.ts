/**
 * The Arduino Uno, Nano and Mega 2560 in 3D: original drawings from the boards' published outlines
 * (size, header positions, USB socket, power jack, main chip). No logos or artwork are copied; the
 * board carries its name and the pin labels.
 *
 * Millimetres, the PCB's underside at y = 0, centred on the board, x to the right and z towards the
 * learner. Headers come from `BOARD_OUTLINES` in core, the same numbers the wiring rules use, and
 * every part carries `userData.label` for the workbench's pointer hint.
 */
import * as THREE from 'three';
import { BOARD_OUTLINES, headerPositions, type ArduinoModel } from '@tariro-studio/core';

const T = 1.6;
/** Header top above the PCB top: the same height the workbench uses for every board's pins. */
const HEADER = 8.5;
const PITCH = 2.54;

export function buildArduinoBoard(model: ArduinoModel, name: string): THREE.Group {
  const o = BOARD_OUTLINES[model];
  const g = new THREE.Group();
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const M = {
    black: std({ color: 0x141414, roughness: 0.6 }),
    chip: std({ color: 0x1b1b1c, roughness: 0.75 }),
    metal: std({ color: 0xd0d3d8, metalness: 1, roughness: 0.3 }),
    gold: std({ color: 0xd8ac4e, metalness: 1, roughness: 0.3 }),
    hole: std({ color: 0x050505, roughness: 1 }),
    side: std({ color: new THREE.Color(o.colour).multiplyScalar(0.7), roughness: 0.6 }),
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, label?: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    if (label) m.userData['label'] = label;
    g.add(m);
    return m;
  };
  // Outline millimetres (origin bottom-left, y up) to bench millimetres (centred, z towards the learner).
  const X = (x: number) => x - o.width / 2;
  const Z = (y: number) => -(y - o.depth / 2);

  // The PCB, its top drawn with the name and every header's pin labels.
  const px = 14;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(o.width * px);
  canvas.height = Math.round(o.depth * px);
  const c = canvas.getContext('2d')!;
  c.fillStyle = `#${o.colour.toString(16).padStart(6, '0')}`;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = 0.35 * px;
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.moveTo((o.width * 0.3 + i * 3) * px, o.depth * 0.25 * px);
    c.lineTo((o.width * 0.3 + i * 3) * px, o.depth * 0.6 * px);
    c.lineTo((o.width * 0.7 + i * 2) * px, o.depth * 0.6 * px);
    c.stroke();
  }
  c.fillStyle = '#f2f6f8';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${(model === 'nano' ? 2.2 : 4) * px}px Inter Variable, sans-serif`;
  c.fillText(name.replace(/^Arduino\s+/, '').toUpperCase(), (o.width * (model === 'nano' ? 0.5 : 0.42)) * px, (o.depth * (model === 'nano' ? 0.5 : 0.62)) * px);
  c.font = `bold ${1.35 * px}px Inter Variable, sans-serif`;
  for (const h of o.headers) {
    const inward = h.y > o.depth / 2 ? 1 : -1; // labels sit just inside the header
    for (const [i, pin] of h.pins.entries()) {
      if (!pin) continue;
      const hx = h.x + i * h.dx;
      const hy = h.y + i * h.dy;
      const ly = h.dx === 0 ? hy : hy - inward * 3.2;
      const lx = h.dx === 0 ? hx - (hx > o.width / 2 ? 3.6 : -3.6) : hx;
      c.fillStyle = pin === '5V' ? '#ff9a8f' : pin === 'GND' ? '#c4ced6' : '#ffffff';
      c.fillText(pin, lx * px, (o.depth - ly) * px);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const top = std({ map: tex, roughness: 0.5 });
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(o.width, T, o.depth), [M.side, M.side, top, M.side, M.side, M.side]);
  pcb.position.set(0, T / 2, 0);
  pcb.castShadow = pcb.receiveShadow = true;
  pcb.userData['label'] = name;
  g.add(pcb);

  // Headers: a black strip per header, with a socket (female) or a gold pin (male) at each position.
  const holeGeo = new THREE.BoxGeometry(1, 0.2, 1);
  for (const h of o.headers) {
    const pos = headerPositions(o, h);
    const xs = pos.map((p) => p.x);
    const zs = pos.map((p) => p.z);
    const [cx, cz] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    const [w, d] = [Math.max(...xs) - Math.min(...xs) + PITCH, Math.max(...zs) - Math.min(...zs) + PITCH];
    const strip = h.kind === 'female' ? HEADER : 2.5;
    add(new THREE.BoxGeometry(w, strip, d), M.black, cx, T + strip / 2, cz, h.label);
    for (const p of pos) {
      if (h.kind === 'female') add(holeGeo, M.hole, p.x, T + HEADER + 0.01, p.z);
      else {
        // A male pin stands up to the same height as a socket's top, so wires plug in at one height.
        const pin = add(new THREE.BoxGeometry(0.64, HEADER - 2.5, 0.64), M.gold, p.x, T + 2.5 + (HEADER - 2.5) / 2, p.z);
        pin.userData['label'] = h.label;
      }
    }
  }

  // Tall parts: USB socket, power jack, chips.
  for (const [kind, fx, fy, fw, fd] of o.features) {
    const [x, z] = [X(fx + fw / 2), Z(fy)];
    if (kind === 'usb-b') add(new THREE.BoxGeometry(fw, 11, fd), M.metal, x, T + 5.5, z, 'USB socket');
    else if (kind === 'usb-mini') add(new THREE.BoxGeometry(fw, 4, fd), M.metal, x, T + 2, z, 'Mini USB socket');
    else if (kind === 'jack') add(new THREE.BoxGeometry(fw, 11, fd), M.black, x, T + 5.5, z, 'Power jack (7–12 V)');
    else add(new THREE.BoxGeometry(fw, 1.4, fd), M.chip, X(fx), T + 0.7, Z(fy), kind === 'chip' ? 'Microcontroller' : 'USB chip');
  }
  return g;
}
