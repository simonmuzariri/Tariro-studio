/**
 * Drone Studio's 3D flight view (three.js, centimetres). The simulator's frame (x right, y forwards,
 * z up) maps to three.js as x → x, z → y, y → −z: "forwards" points away from the learner.
 *
 * Drawn from primitives (our own design): a small quadcopter with propeller guards, a camera at the
 * front and a status light; its shadow; the take-off pad; the learner's limits as a see-through
 * cylinder (fence and height ceiling); and the flight path.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DroneLimits, DroneState, PathPoint } from '@tariro-studio/core';

const rad = (d: number) => (d * Math.PI) / 180;
const toScene = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

export class DroneScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  private readonly controls: OrbitControls;
  private readonly drone = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly rotors: THREE.Object3D[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly light: THREE.MeshBasicMaterial;
  private limitsGroup = new THREE.Group();
  private path: THREE.Line;
  private pathCount = -1;
  private readonly resize: ResizeObserver;
  private ground: THREE.Mesh;
  /** Keep the drone in the middle of the view as it flies. */
  follow = false;

  constructor(private readonly host: HTMLElement, theme: 'light' | 'dark') {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'drone-canvas';
    this.renderer.domElement.setAttribute('data-testid', 'drone-canvas');
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = rad(88);
    this.controls.minDistance = 40;
    this.controls.maxDistance = 4000;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6270, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-300, 800, 400);
    this.scene.add(sun);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
    const grid = new THREE.GridHelper(4000, 80, 0x8892a0, 0xb8c0cc);
    grid.position.y = 0.2;
    this.scene.add(grid);

    // The take-off pad: an "H" in a circle, 40 cm across.
    const pad = new THREE.Mesh(new THREE.CircleGeometry(20, 48), new THREE.MeshStandardMaterial({ color: 0x2d3440 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.4;
    const h = new THREE.Group();
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const [w, d, x] of [
      [2.4, 18, -6],
      [2.4, 18, 6],
      [12, 2.4, 0],
    ] as const) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, d), white);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(x, 0.6, 0);
      h.add(bar);
    }
    this.scene.add(pad, h);

    // The drone: about 18 cm across, like a Tello.
    const shell = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 13), shell);
    body.position.y = 2;
    this.body.add(body);
    const camera = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1, 20), dark);
    camera.rotation.x = Math.PI / 2;
    camera.position.set(0, 2, -6.8);
    this.body.add(camera);
    this.light = new THREE.MeshBasicMaterial({ color: 0x3ddc84 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), this.light);
    led.position.set(0, 4.2, -5);
    this.body.add(led);
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 9), shell);
      arm.position.set(sx * 4.5, 2.4, sz * 4.5);
      arm.rotation.y = sx * sz * rad(45);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 16), dark);
      hub.position.set(sx * 7.6, 2.6, sz * 7.6);
      const guard = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.35, 8, 40), shell);
      guard.rotation.x = Math.PI / 2;
      guard.position.set(sx * 7.6, 3.4, sz * 7.6);
      const rotor = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.2, 0.9), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.85 }));
      const blade2 = blade.clone();
      blade2.rotation.y = Math.PI / 2;
      rotor.add(blade, blade2);
      rotor.position.set(sx * 7.6, 3.9, sz * 7.6);
      this.rotors.push(rotor);
      this.body.add(arm, hub, guard, rotor);
    }
    this.body.rotation.order = 'YXZ';
    this.drone.add(this.body);
    this.scene.add(this.drone);

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(10, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.5;
    this.scene.add(this.shadow);

    this.path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd6000f }));
    this.scene.add(this.path, this.limitsGroup);

    this.setTheme(theme);
    this.resetView();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
  }

  dispose(): void {
    this.resize.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.scene.background = new THREE.Color(theme === 'dark' ? 0x161a21 : 0xdfe7f0);
    (this.ground.material as THREE.MeshStandardMaterial).color.set(theme === 'dark' ? 0x2a2f38 : 0xcfd6df);
  }

  /** The learner's limits: a see-through cylinder, the fence round the take-off spot up to the height ceiling. */
  setLimits(l: DroneLimits): void {
    this.limitsGroup.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.limitsGroup.clear();
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(l.fenceRadius, l.fenceRadius, l.maxHeight, 96, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }),
    );
    wall.position.y = l.maxHeight / 2;
    const edge = (y: number) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(l.fenceRadius, 1.2, 6, 160), new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.55 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      return ring;
    };
    this.limitsGroup.add(wall, edge(0.8), edge(l.maxHeight));
  }

  resetView(): void {
    // Close enough to see the drone (18 cm across) flying a 1 m square round the pad.
    this.camera.position.set(110, 150, 190);
    this.controls.target.set(40, 55, -60);
    this.controls.update();
  }

  /** Draw the drone where the simulator has it, and its path so far. */
  update(s: DroneState, path: readonly PathPoint[], dt: number): void {
    const at = toScene(s.x, s.y, s.z);
    this.drone.position.copy(at);
    this.body.rotation.y = -rad(s.heading);
    this.body.rotation.x = -rad(s.pitch);
    this.body.rotation.z = -rad(s.roll);
    const spinning = s.flying && s.phase !== 'falling';
    for (const [i, r] of this.rotors.entries()) r.rotation.y += (spinning ? 40 : 0) * dt * (i % 2 ? 1 : -1);
    this.light.color.setHex(s.phase === 'falling' ? 0xff3b30 : s.battery < 20 ? 0xffb300 : s.flying ? 0x3ddc84 : 0x7a8594);
    this.shadow.position.set(at.x, 0.5, at.z);
    const k = Math.max(0.3, 1 - s.z / 600);
    this.shadow.scale.setScalar(k);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.28 * k;
    if (path.length !== this.pathCount) {
      this.pathCount = path.length;
      this.path.geometry.dispose();
      this.path.geometry = new THREE.BufferGeometry().setFromPoints(path.map((p) => toScene(p.x, p.y, p.z)));
    }
    if (this.follow) {
      const target = at.clone();
      const moved = target.sub(this.controls.target).multiplyScalar(Math.min(1, dt * 3));
      this.controls.target.add(moved);
      this.camera.position.add(moved);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private fit(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
