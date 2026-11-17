/**
 * The Malkon SMRS board in 3D (the Tariro robot's controller), adapted from Omorfo Tech Labs' own
 * board model: the board photo is the top of the PCB, and the tall parts (headers, terminals,
 * chips, jacks) stand on it where they are in the photo.
 *
 * Millimetres, the PCB's underside at y = 0, x to the right and z towards the learner. Headers and
 * their pins come from `SMRS_HEADERS` in core, the same numbers the wiring rules use.
 * Every part carries `userData.label`, which the workbench shows when the pointer is over it.
 */
import * as THREE from 'three';
import { SMRS_HEADERS, SMRS_MM_PER_PX as S, SMRS_PHOTO, smrsHeaderPositions, smrsMm } from '@tariro-studio/core';
import photoUrl from '../assets/boards/malkon-smrs.jpg';

/** PCB thickness. */
const T = 1.6;
/** Height of every header's top above the PCB's top (female socket top and male pin tips). */
export const SMRS_HEADER_TOP = T + 8.5;

const P = (px: number, py: number): [number, number] => {
  const p = smrsMm(px, py);
  return [p.x, p.z];
};

export function buildSmrsBoard(onTexture: () => void): THREE.Group {
  const board = new THREE.Group();
  const tex = new THREE.TextureLoader().load(photoUrl, onTexture);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const M = {
    photo: std({ map: tex, roughness: 0.5, metalness: 0 }),
    pcbSide: std({ color: 0x163f8f, roughness: 0.6 }),
    pcbBottom: std({ color: 0x1a4aa6, roughness: 0.55 }),
    blue: std({ color: 0x1f62d6, roughness: 0.42 }),
    black: std({ color: 0x161616, roughness: 0.55 }),
    chip: std({ color: 0x1b1b1c, roughness: 0.75 }),
    metal: std({ color: 0xd0d3d8, metalness: 1, roughness: 0.28 }),
    tin: std({ color: 0xb9bcc2, metalness: 1, roughness: 0.4 }),
    gold: std({ color: 0xd8ac4e, metalness: 1, roughness: 0.3 }),
    hole: std({ color: 0x050505, roughness: 1 }),
    cap: std({ color: 0x7d1c22, roughness: 0.45 }),
    white: std({ color: 0xf2f2ee, roughness: 0.4 }),
  };

  const comp = (label: string) => {
    const g = new THREE.Group();
    g.userData['label'] = label;
    board.add(g);
    return g;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], g: THREE.Group) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  /** Map the upward faces of a centred geometry onto the photo. */
  const photoTop = (geo: THREE.BufferGeometry, cpx: number, cpy: number) => {
    const p = geo.attributes['position']!;
    const n = geo.attributes['normal']!;
    const uv = geo.attributes['uv']!;
    for (let i = 0; i < p.count; i++)
      if (n.getY(i) > 0.9) {
        const px = cpx + p.getX(i) / S;
        const py = cpy + p.getZ(i) / S;
        uv.setXY(i, px / SMRS_PHOTO.width, 1 - py / SMRS_PHOTO.height);
      }
    uv.needsUpdate = true;
  };
  const box = (g: THREE.Group, x1: number, y1: number, x2: number, y2: number, h: number, mat: THREE.Material, base = T, photo = false) => {
    const [ax, az] = P(x1, y1);
    const [bx, bz] = P(x2, y2);
    const geo = new THREE.BoxGeometry(bx - ax, h, bz - az);
    let m: THREE.Material | THREE.Material[] = mat;
    if (photo) {
      photoTop(geo, (x1 + x2) / 2, (y1 + y2) / 2);
      m = [mat, mat, M.photo, mat, mat, mat];
    }
    const me = mesh(geo, m, g);
    me.position.set((ax + bx) / 2, base + h / 2, (az + bz) / 2);
    return me;
  };
  const boxMM = (g: THREE.Group, cx: number, cz: number, w: number, h: number, d: number, mat: THREE.Material, base: number) => {
    const me = mesh(new THREE.BoxGeometry(w, h, d), mat, g);
    me.position.set(cx, base + h / 2, cz);
    return me;
  };
  const cyl = (g: THREE.Group, cpx: number, cpy: number, rpx: number, h: number, mat: THREE.Material, base = T, photo = false, seg = 48) => {
    const r = rpx * S;
    const geo = new THREE.CylinderGeometry(r, r, h, seg);
    let m: THREE.Material | THREE.Material[] = mat;
    if (photo) {
      photoTop(geo, cpx, cpy);
      m = [mat, M.photo, mat];
    }
    const [x, z] = P(cpx, cpy);
    const me = mesh(geo, m, g);
    me.position.set(x, base + h / 2, z);
    return me;
  };

  // ── PCB: the outline with its cut corner and four mounting holes, the photo on top ──
  const MOUNTS = [
    [400, 122],
    [968, 290],
    [966, 612],
    [393, 665],
  ] as const;
  const outline = () => {
    const pts = (
      [
        [228, 95],
        [975, 95],
        [975, 238],
        [1005, 268],
        [1005, 662],
        [975, 692],
        [228, 692],
      ] as const
    ).map(([x, y]) => {
      const [a, b] = P(x, y);
      return new THREE.Vector2(a, -b);
    });
    const s = new THREE.Shape(pts);
    for (const [hx, hy] of MOUNTS) {
      const [a, b] = P(hx, hy);
      const h = new THREE.Path();
      h.absarc(a, -b, 1.6, 0, Math.PI * 2, true);
      s.holes.push(h);
    }
    return s;
  };
  {
    const g = comp('Malkon SMRS board');
    const body = new THREE.ExtrudeGeometry(outline(), { depth: T, bevelEnabled: false, curveSegments: 24 });
    body.rotateX(-Math.PI / 2);
    mesh(body, [M.pcbBottom, M.pcbSide], g);
    const top = new THREE.ShapeGeometry(outline(), 24);
    top.rotateX(-Math.PI / 2);
    const p = top.attributes['position']!;
    const uv = top.attributes['uv']!;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i) / S + 616;
      const py = p.getZ(i) / S + 395;
      uv.setXY(i, px / SMRS_PHOTO.width, 1 - py / SMRS_PHOTO.height);
    }
    const tm = mesh(top, M.photo, g);
    tm.position.y = T + 0.01;
    tm.castShadow = false;
    for (const [hx, hy] of MOUNTS) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.6, 32), M.tin);
      ring.rotation.x = -Math.PI / 2;
      const [x, z] = P(hx, hy);
      ring.position.set(x, T + 0.03, z);
      g.add(ring);
      // Standoff underneath.
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 4, 12), M.metal);
      post.position.set(x, -2, z);
      post.castShadow = true;
      g.add(post);
    }
  }

  // ── headers, from the shared pin map ──
  for (const h of SMRS_HEADERS) {
    const g = comp(h.label);
    const [x1, y1, x2, y2] = h.rect;
    if (h.kind === 'female') box(g, x1, y1, x2, y2, 8.5, M.blue);
    else box(g, x1, y1, x2, y2, 2.5, M.blue);
    for (const p of smrsHeaderPositions(h)) {
      if (h.kind === 'female') {
        boxMM(g, p.x, p.z, 1.0, 0.05, 1.0, M.hole, T + 8.5);
        boxMM(g, p.x, p.z, 0.6, 3, 0.6, M.gold, T - 3);
      } else {
        boxMM(g, p.x, p.z, 0.64, 11.2, 0.64, M.gold, T - 3);
        const tip = mesh(new THREE.ConeGeometry(0.45, 0.5, 4), M.gold, g);
        tip.rotation.y = Math.PI / 4;
        tip.position.set(p.x, T + 8.45, p.z);
      }
    }
  }

  // ── screw terminals ──
  const terminal = (label: string, x1: number, y1: number, x2: number, y2: number, screws: Array<[number, number]>, face: 'x' | 'z') => {
    const g = comp(label);
    box(g, x1, y1, x2, y2, 10, M.blue);
    const [, , bx, bz] = [...P(x1, y1), ...P(x2, y2)];
    for (const [sx, sy] of screws) {
      const [x, z] = P(sx, sy);
      const well = mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.05, 32), M.hole, g);
      well.position.set(x, T + 10.0, z);
      const sc = mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 32), M.metal, g);
      sc.position.set(x, T + 10.05, z);
      const slot = boxMM(g, x, z, 2.6, 0.3, 0.45, M.black, T + 10.2);
      slot.rotation.y = Math.PI / 4;
      if (face === 'x') boxMM(g, bx! + 0.01, z, 0.1, 3.2, 3.2, M.hole, T + 2.2);
      else boxMM(g, x, bz! + 0.01, 3.2, 3.2, 0.1, M.hole, T + 2.2);
    }
  };
  terminal('Motor B terminal (driver pins D7 direction, D6 speed)', 915, 337, 1015, 455, [[975, 368], [975, 425]], 'x');
  terminal('Motor A terminal (driver pins D4 direction, D5 speed)', 915, 457, 1015, 572, [[975, 487], [975, 545]], 'x');
  terminal('Battery input (3.7–12 V)', 418, 605, 535, 697, [[450, 660], [508, 660]], 'z');

  // ── chips ──
  const ic = (label: string, x1: number, y1: number, x2: number, y2: number, h: number, base: number, side: 'x' | 'y', n: number, legW: number, legL: number, dip = false) => {
    const g = comp(label);
    box(g, x1, y1, x2, y2, h, M.chip, base, true);
    const [ax, az] = P(x1, y1);
    const [bx, bz] = P(x2, y2);
    for (let i = 0; i < n; i++) {
      if (side === 'y') {
        const x = ax + ((i + 0.5) * (bx - ax)) / n;
        for (const [z, dir] of [
          [az, -1],
          [bz, 1],
        ] as const) {
          if (dip) {
            boxMM(g, x, z + dir * 0.5, legW, 0.25, 1.0, M.tin, base + 1.0);
            boxMM(g, x, z + dir * 1.0, legW * 0.6, base + 1.1 - T + 3, 0.25, M.tin, T - 3);
          } else boxMM(g, x, z + (dir * legL) / 2, legW, 0.2, legL, M.tin, T);
        }
      } else {
        const z = az + ((i + 0.5) * (bz - az)) / n;
        for (const [x, dir] of [
          [ax, -1],
          [bx, 1],
        ] as const)
          boxMM(g, x + (dir * legL) / 2, z, legL, 0.2, legW, M.tin, T);
      }
    }
  };
  ic('ATmega328P microcontroller', 490, 276, 895, 356, 3.4, T + 0.8, 'y', 14, 1.2, 0, true);
  ic('CH340 USB-to-serial chip', 352, 214, 464, 268, 1.5, T + 0.1, 'y', 8, 0.42, 1.0);
  ic('TB6612FNG motor driver', 710, 437, 795, 530, 1.1, T + 0.1, 'x', 12, 0.3, 0.9);
  ic('MOSFET', 645, 450, 672, 472, 0.9, T + 0.05, 'x', 3, 0.35, 0.6);
  ic('MOSFET', 645, 483, 672, 505, 0.9, T + 0.05, 'x', 3, 0.35, 0.6);
  for (const [label, y1, y2] of [
    ['5 V regulator', 378, 445],
    ['3.3 V regulator', 452, 520],
  ] as const) {
    const g = comp(label);
    box(g, 500, y1 + 6, 522, y2 - 6, 0.5, M.tin);
    box(g, 447, y1, 505, y2, 2.3, M.chip, T, true);
    const [, az] = P(0, y1);
    const [, bz] = P(0, y2);
    const [lx] = P(437, 0);
    for (const k of [0.2, 0.8]) boxMM(g, lx, az + (bz - az) * k, 1.8, 0.3, 0.7, M.tin, T);
  }

  // ── crystal ──
  {
    const g = comp('16 MHz crystal');
    const [ax, az] = P(662, 207);
    const [bx, bz] = P(783, 253);
    const w = bx - ax;
    const r = (bz - az) / 2;
    const sh = new THREE.Shape();
    sh.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    sh.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 3.5, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 3, curveSegments: 24 });
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    const m = mesh(geo, M.metal, g);
    m.position.set((ax + bx) / 2, T + 0.3, (az + bz) / 2);
    box(g, 662, 207, 783, 253, 0.3, M.tin);
  }

  // ── connectors and the rest ──
  {
    const g = comp('USB-C port (5 V in, programming)');
    const [ax, az] = P(203, 182);
    const [bx, bz] = P(298, 263);
    const sh = new THREE.Shape();
    const w = bz - az;
    const h = 3.2;
    const r = 1.4;
    sh.moveTo(-w / 2 + r, 0);
    sh.lineTo(w / 2 - r, 0);
    sh.absarc(w / 2 - r, r, r, -Math.PI / 2, 0);
    sh.lineTo(w / 2, h - r);
    sh.absarc(w / 2 - r, h - r, r, 0, Math.PI / 2);
    sh.lineTo(-w / 2 + r, h);
    sh.absarc(-w / 2 + r, h - r, r, Math.PI / 2, Math.PI);
    sh.lineTo(-w / 2, r);
    sh.absarc(-w / 2 + r, r, r, Math.PI, Math.PI * 1.5);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: bx - ax, bevelEnabled: false, curveSegments: 12 });
    geo.rotateY(Math.PI / 2);
    const m = mesh(geo, M.metal, g);
    m.position.set(ax, T, (az + bz) / 2);
    boxMM(g, ax - 0.01, (az + bz) / 2, 0.1, 2.0, w - 1.4, M.hole, T + 0.6);
    boxMM(g, ax + 0.3, (az + bz) / 2, 0.6, 0.7, w - 3.5, M.black, T + 1.25);
  }
  {
    const g = comp('DC barrel jack (7–12 V)');
    box(g, 180, 547, 350, 655, 11, M.black);
    const [ax, az] = P(180, 547);
    const [, bz] = P(0, 655);
    const hole = mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.3, 40), M.hole, g);
    hole.rotation.z = Math.PI / 2;
    hole.position.set(ax - 0.05, T + 6, (az + bz) / 2);
    const pin = mesh(new THREE.CylinderGeometry(1.0, 1.0, 4, 20), M.metal, g);
    pin.rotation.z = Math.PI / 2;
    pin.position.set(ax + 1.5, T + 6, (az + bz) / 2);
  }
  {
    const g = comp('Reset button');
    box(g, 248, 97, 322, 165, 3.2, M.metal);
    box(g, 256, 105, 314, 157, 0.4, M.black, T + 3.2);
    cyl(g, 285, 131, 17, 1.4, M.black, T + 3.6);
  }
  {
    const g = comp('Buzzer (pin set by the BUZ jumper)');
    cyl(g, 272, 430, 46, 9, M.black, T, false, 64);
    cyl(g, 272, 430, 6, 0.05, M.hole, T + 9);
  }
  {
    const g = comp('IR receiver (pin set by the IR jumper)');
    box(g, 236, 302, 270, 358, 4, M.black);
    const s = mesh(new THREE.SphereGeometry(1.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.black, g);
    const [x, z] = P(253, 330);
    s.position.set(x, T + 4, z);
  }
  box(comp('RGB LED (pins set by the RGB jumpers)'), 238, 485, 290, 540, 1.6, M.white, T, true);
  for (const cx of [410, 485]) {
    const g = comp('Capacitor');
    cyl(g, cx, 558, 34, 9.5, M.cap, T, true, 64);
    cyl(g, cx, 558, 35, 0.6, M.black, T);
  }
  for (const [x1, y1, x2, y2, label] of [
    [392, 163, 410, 190, 'Power LED'],
    [530, 175, 555, 190, 'RX LED'],
    [530, 197, 555, 212, 'TX LED'],
    [565, 400, 585, 425, 'Pin 13 LED'],
  ] as const)
    box(comp(label), x1, y1, x2, y2, 0.6, M.white, T, true);

  return board;
}
