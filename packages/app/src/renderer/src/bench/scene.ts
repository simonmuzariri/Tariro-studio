/**
 * The 3D workbench scene (three.js). Everything is modelled in millimetres from the shared
 * breadboard geometry in `@tariro-studio/core`, so a hole in the picture is exactly the hole the
 * connectivity rules use. Models are drawn from primitives, except the boards with a real model:
 * the Malkon SMRS (smrsModel.ts, with its board photo) and the Malkon One (malkonOneModel.ts, glTF).
 *
 * The scene owns the pointer interaction (orbit, pick, drag, place, wire) and reports what the
 * learner did through `BenchEvents`; the React component turns those into layout edits.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  allHoles,
  benchConnectors,
  benchModel,
  BOARD_Z,
  boardPlacement,
  showsBoard,
  showsBreadboard,
  CHASSIS,
  ON_TABLE,
  type BoardPlacement,
  boardPinOrder,
  canonicalPin,
  isMotorTerminal,
  motorTerminalName,
  COLUMNS,
  connectionPosition,
  holePosition,
  legHoles,
  nearestHole,
  parseHole,
  PART_KINDS,
  PITCH,
  pinPosition,
  RAILS,
  ROWS,
  type BoardDefinition,
  type CircuitLayout,
  type PartState,
  type PlaceableKind,
  type PlacedPart,
  type SimState,
} from '@tariro-studio/core';
import { buildChassis, WHEEL_DIAMETER, WHEEL_TRACK, WHEEL_TURNS_PER_SECOND, type ChassisView } from './chassisModel';
import { buildMalkonOneBoard } from './malkonOneModel';
import { buildMotor } from './motorModel';
import { buildSmrsBoard } from './smrsModel';

export type BenchMode = { kind: 'select' } | { kind: 'place'; part: PlaceableKind } | { kind: 'wire'; colour: string } | { kind: 'probe' };

/** An instrument probe touching a connection point. */
export interface Probe {
  conn: string;
  colour: number;
}

export interface BenchEvents {
  select(id: string | null): void;
  place(kind: PlaceableKind, row: number, col: number, rotation: 0 | 90): void;
  move(id: string, row: number, col: number): void;
  wire(from: string, to: string): void;
  /** While running: a button pressed or released, a switch flipped. */
  operate(partId: string, value: number): void;
  /** Probe mode: the learner clicked a connection point, or a part (for the ammeter). */
  probe(conn: string | undefined, partId: string | undefined): void;
  /** Text describing what the pointer is over (null when nothing). */
  hover(text: string | null): void;
  /** Can this part go here? (checked by the owner, which knows the layout) */
  canPlace(part: Pick<PlacedPart, 'kind' | 'row' | 'col' | 'rotation'>, except?: string): boolean;
  /** Which pin or rail a connection point is joined to, for the hover text. */
  describe(id: string): string;
}

const BB_W = COLUMNS * PITCH + 8;
const BB_D = 55;
const BB_H = 8.5;
const PCB_Y = 4;
const PCB_T = 1.6;
const HEADER_H = 8.5;
/** Top of the board headers (the Malkon SMRS model uses the same height: SMRS_HEADER_TOP). */
const PIN_TOP = PCB_Y + PCB_T + HEADER_H;
/** How far the robot car may drive from its start (the table is 2.4 m across). */
const TABLE_REACH = 1000;
const LED_COLOURS: Record<string, number> = { red: 0xff2a1f, yellow: 0xffd000, green: 0x22dd55, blue: 0x2a7bff, white: 0xf0f4ff };
const BAND = [0x111111, 0x7a3b12, 0xd81b1b, 0xff7a00, 0xffd400, 0x1f9d3a, 0x1f5fd6, 0x8a33c9, 0x8c8c8c, 0xf2f2f2];

/** Resistor colour code: two digits, then the multiplier, then gold for ±5 %. */
export function resistorBands(ohms: number): number[] {
  const exp = Math.max(0, Math.floor(Math.log10(Math.max(ohms, 10))) - 1);
  const digits = Math.round(ohms / 10 ** exp);
  return [BAND[Math.floor(digits / 10) % 10]!, BAND[digits % 10]!, BAND[Math.min(exp, 9)]!, 0xc9a227];
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, px: number) => void, pxPerMm: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = Math.round(w * pxPerMm);
  c.height = Math.round(h * pxPerMm);
  const g = c.getContext('2d')!;
  draw(g, pxPerMm);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

interface PartView {
  group: THREE.Group;
  /** Materials tinted while selected. */
  materials: THREE.MeshStandardMaterial[];
  update(state: PartState | undefined, running: boolean): void;
  /** Called every frame while the bench animates (a turning motor), `dt` in seconds. */
  tick?(dt: number): void;
  /** A motor: how far its wheel has turned, in turns. */
  turns?(): number;
}

export class BenchScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly table: THREE.Mesh;
  private readonly partsRoot = new THREE.Group();
  private readonly wiresRoot = new THREE.Group();
  private readonly marker: THREE.Mesh;
  private readonly startMarker: THREE.Mesh;
  private readonly probesRoot = new THREE.Group();
  private ghost: THREE.Group | undefined;
  private boardRoot = new THREE.Group();
  private breadboardGroup: THREE.Group;
  /** The car's pivot (at its centre, moved and turned as it drives) and what rides on it. */
  private readonly carPivot = new THREE.Group();
  private readonly carInner = new THREE.Group();
  private readonly carParts = new THREE.Group();
  /** Where the car has driven to from its starting place: millimetres, and its turn (radians, + = left). */
  private carPose = { x: 0, z: 0, heading: 0 };
  private place: BoardPlacement = ON_TABLE;
  /** The robot car, when there is one: motors on the board's terminals are its motors. */
  private chassis: ChassisView | undefined;
  private modelFailed = false;
  private views = new Map<string, PartView>();
  private wireMeshes = new Map<string, THREE.Mesh>();
  private layout: CircuitLayout = { version: 1, parts: [], wires: [] };
  private state: SimState | undefined;
  private running = false;
  private mode: BenchMode = { kind: 'select' };
  private selected: string | null = null;
  private wireStart: string | null = null;
  private rotation: 0 | 90 = 0;
  private drag: { id: string; startX: number; startY: number; moved: boolean; target?: { row: number; col: number } } | null = null;
  private pressed: string | null = null;
  private frame = 0;
  private lastFrame = 0;
  private animating = false;
  private disposed = false;
  private readonly resize: ResizeObserver;
  /** Space covered by side panels, in CSS px: the bench is centred in what is left. */
  private insets = { left: 0, right: 0 };

  constructor(
    private readonly host: HTMLElement,
    private board: BoardDefinition,
    private readonly events: BenchEvents,
    theme: 'dark' | 'light',
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'bench-canvas';
    this.renderer.domElement.setAttribute('data-testid', 'bench-canvas');
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 50;
    this.controls.maxDistance = 520;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener('change', () => this.requestRender());

    // Light: soft sky fill and one key light with shadows, like a desk lamp.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-80, 220, 140);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 10, far: 600 });
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    this.table = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ roughness: 0.92 }));
    this.table.rotation.x = -Math.PI / 2;
    this.table.receiveShadow = true;
    this.scene.add(this.table);
    this.setTheme(theme);

    // The robot car (board, chassis and its motors) can drive: they hang from a pivot at the car's centre.
    this.carPivot.position.set(0, 0, CHASSIS.z);
    this.carInner.position.set(0, 0, -CHASSIS.z);
    this.carInner.add(this.boardRoot, this.carParts);
    this.carPivot.add(this.carInner);
    this.breadboardGroup = this.makeBreadboard();
    this.scene.add(this.breadboardGroup, this.carPivot, this.partsRoot, this.wiresRoot);
    this.rebuildBoard();

    const ring = (colour: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.55, 24), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthTest: false }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 10;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.marker = ring(0x3fb950);
    this.startMarker = ring(0xffd166);
    this.scene.add(this.probesRoot);

    this.resetView();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ───────────────────────── public controls ─────────────────────────

  setTheme(theme: 'dark' | 'light'): void {
    this.scene.background = new THREE.Color(theme === 'dark' ? 0x14161b : 0xdfe3ea);
    (this.table.material as THREE.MeshStandardMaterial).color.set(theme === 'dark' ? 0x24272f : 0xc9ced8);
    this.requestRender();
  }

  setBoard(board: BoardDefinition): void {
    this.board = board;
    this.rebuildBoard();
    this.rebuildWires();
  }

  setInsets(left: number, right: number): void {
    this.insets = { left, right };
    this.fit();
  }

  setMode(mode: BenchMode): void {
    this.mode = mode;
    this.wireStart = null;
    this.startMarker.visible = false;
    this.removeGhost();
    if (mode.kind === 'place') {
      this.ghost = this.makePart({ id: 'ghost', kind: mode.part, row: 0, col: 1, rotation: this.rotation, colour: 'red', ohms: 220 }).group;
      this.ghost.visible = false;
      this.ghost.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat) {
          mat.transparent = true;
          mat.opacity = 0.55;
          mat.depthWrite = false;
        }
      });
      this.scene.add(this.ghost);
    }
    this.renderer.domElement.style.cursor = mode.kind === 'select' ? '' : 'crosshair';
    this.requestRender();
  }

  /** Rotation for the next part placed (R key while placing). */
  setPlacementRotation(rotation: 0 | 90): void {
    this.rotation = rotation;
    if (this.mode.kind === 'place') this.setMode(this.mode);
  }

  private hasMotor(layout = this.layout): boolean {
    return layout.parts.some((p) => p.kind === 'dc-motor');
  }

  setLayout(layout: CircuitLayout): void {
    // A motor stands outside the usual view (in front of the breadboard, or beside the board on
    // its screw terminals): when the first one appears there, widen the view to show it.
    const frame = (l: CircuitLayout) => (l.parts.some((p) => p.kind === 'chassis') ? 3 : l.parts.some((p) => p.terminal) ? 2 : this.hasMotor(l) ? 1 : 0);
    const wider = frame(layout) > frame(this.layout);
    this.layout = layout;
    // The board stands on the table, or on the robot car's deck when there is a chassis.
    const place = boardPlacement(layout);
    if (place.z !== this.place.z || place.lift !== this.place.lift) {
      this.place = place;
      this.boardRoot.position.set(0, place.lift, place.z - BOARD_Z);
      this.rebuildWires();
    }
    if (wider) this.resetView();
    // The learner chooses what is on the bench: it starts empty.
    this.breadboardGroup.visible = showsBreadboard(layout);
    this.boardRoot.visible = showsBoard(layout);
    if (!layout.parts.some((p) => p.kind === 'chassis')) this.resetCar();
    for (const v of this.views.values()) this.disposeGroup(v.group);
    this.views.clear();
    this.partsRoot.clear();
    this.carParts.clear();
    // The chassis first: the motors on its terminals are drawn as its own motors.
    this.chassis = undefined;
    for (const p of [...layout.parts].sort((a, b) => (a.kind === 'chassis' ? 0 : 1) - (b.kind === 'chassis' ? 0 : 1))) {
      const view = this.makePart(p);
      this.views.set(p.id, view);
      // The chassis and the motors it carries ride on the car; everything else stays on the table.
      const rides = p.kind === 'chassis' || (p.kind === 'dc-motor' && !!p.terminal && !!this.chassis);
      (rides ? this.carParts : this.partsRoot).add(view.group);
    }
    this.rebuildWires();
    this.applySelection();
    this.updateParts();
  }

  /** Draw instrument probes: a coloured tip on each point, with its lead rising out of the bench. */
  setProbes(probes: Probe[]): void {
    this.disposeGroup(this.probesRoot);
    this.probesRoot.clear();
    for (const p of probes) {
      const at = this.pos(p.conn);
      if (!at) continue;
      const y = this.connY(p.conn);
      const mat = new THREE.MeshStandardMaterial({ color: p.colour, roughness: 0.35, emissive: p.colour, emissiveIntensity: 0.25 });
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3, 16).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.9, roughness: 0.25 }));
      tip.position.set(at.x, y + 1.5, at.z);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.1, 12, 20), mat);
      handle.position.set(at.x, y + 9, at.z);
      const lead = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(at.x, y + 15, at.z), new THREE.Vector3(at.x, y + 30, at.z + 10), new THREE.Vector3(at.x * 0.5, y + 45, at.z + 40)]), 24, 0.6, 8),
        mat,
      );
      for (const m of [tip, handle, lead]) {
        m.castShadow = true;
        this.probesRoot.add(m);
      }
    }
    this.requestRender();
  }

  setSelection(id: string | null): void {
    this.selected = id;
    this.applySelection();
  }

  setSimulation(state: SimState, running: boolean): void {
    this.state = state;
    this.running = running;
    this.updateParts();
  }

  resetView(): void {
    // Frames the breadboard and the whole board behind it; with a motor, also the motor in front.
    if (this.layout.parts.some((p) => p.kind === 'chassis')) {
      // The robot car behind the breadboard, with the board on its deck.
      this.camera.position.set(0, 400, 215);
      this.controls.target.set(0, 20, -75);
    } else if (this.layout.parts.some((p) => p.terminal)) {
      // Motors beside the board, on its screw terminals.
      this.camera.position.set(62, 390, 245);
      this.controls.target.set(62, 0, -42);
    } else if (this.hasMotor()) {
      this.camera.position.set(0, 260, 235);
      this.controls.target.set(0, 0, 5);
    } else {
      this.camera.position.set(0, 205, 165);
      this.controls.target.set(0, 0, -30);
    }
    this.controls.update();
    this.requestRender();
  }

  topView(): void {
    this.camera.position.set(0, 320, -29);
    this.controls.target.set(0, 0, -30);
    this.controls.update();
    this.requestRender();
  }

  /** Height of a connection point: the breadboard's top, a header's top, or a screw terminal's wire entry. */
  private connY(id: string): number {
    if (!id.startsWith('pin:')) return BB_H;
    const y = pinPosition(this.board, id, this.place)?.y;
    return (y === undefined ? PIN_TOP : PCB_Y + PCB_T + y) + this.place.lift;
  }

  /**
   * Where a connection is now: a breadboard hole, or a board pin where the board is (on the table,
   * or on the robot car, wherever it has driven to).
   */
  private pos(id: string): { x: number; z: number; y?: number } | undefined {
    const p = connectionPosition(this.board, id, this.place);
    return p && id.startsWith('pin:') ? { ...p, ...this.onCar(p.x, p.z) } : p;
  }
  private pinPos(id: string): { x: number; z: number; y?: number } | undefined {
    const p = pinPosition(this.board, id, this.place);
    return p ? { ...p, ...this.onCar(p.x, p.z) } : p;
  }
  /** A connection's place before the car moved (what the car's own drawings use). */
  private basePos(id: string): { x: number; z: number; y?: number } | undefined {
    return connectionPosition(this.board, id, this.place);
  }
  /** A point on the car's deck (in its starting place) to where the car is now. */
  private onCar(x: number, z: number): { x: number; z: number } {
    const { x: dx, z: dz, heading: h } = this.carPose;
    if (!dx && !dz && !h) return { x, z };
    const rz = z - CHASSIS.z;
    return { x: x * Math.cos(h) + rz * Math.sin(h) + dx, z: -x * Math.sin(h) + rz * Math.cos(h) + CHASSIS.z + dz };
  }

  /** Put the robot car back where it started (and the view with it, if it had followed the car away). */
  resetCar(): void {
    const away = this.carPose.x || this.carPose.z || this.carPose.heading;
    this.carPose = { x: 0, z: 0, heading: 0 };
    this.applyCarPose();
    if (away && this.layout.parts.some((p) => p.kind === 'chassis')) this.resetView();
  }

  /** Where the car is, for tests: millimetres from its start, and its turn in degrees (+ = left). */
  carPosition(): { x: number; z: number; heading: number } {
    return { x: this.carPose.x, z: this.carPose.z, heading: (this.carPose.heading * 180) / Math.PI };
  }

  private applyCarPose(): void {
    this.carPivot.position.set(this.carPose.x, 0, CHASSIS.z + this.carPose.z);
    this.carPivot.rotation.y = this.carPose.heading;
    // Wires from the table to the board stretch as the car moves.
    if (this.layout.wires.some((w) => w.from.startsWith('pin:') || w.to.startsWith('pin:'))) this.rebuildWires(false);
    this.requestRender();
  }

  /**
   * Drive the car for `dt` seconds from its wheel speeds, as a two-wheeled car moves: equal speeds go
   * straight, a faster right wheel turns it left, opposite speeds spin it on the spot. Its front is −z.
   */
  private driveCar(car: ChassisView, dt: number): void {
    const surface = (side: 'A' | 'B') => car.speed(side) * WHEEL_TURNS_PER_SECOND * Math.PI * WHEEL_DIAMETER; // mm/s
    const left = surface('A');
    const right = surface('B');
    if (!left && !right) return;
    const v = (left + right) / 2;
    const w = (right - left) / WHEEL_TRACK;
    const p = this.carPose;
    p.heading += w * dt;
    p.x += -Math.sin(p.heading) * v * dt;
    p.z += -Math.cos(p.heading) * v * dt;
    // The car stays on the table.
    p.x = Math.min(Math.max(p.x, -TABLE_REACH), TABLE_REACH);
    p.z = Math.min(Math.max(p.z, -TABLE_REACH), TABLE_REACH);
    // The view follows the car (keeping the learner's angle), as eyes follow a real one across the floor.
    const moved = new THREE.Vector3(p.x - this.carPivot.position.x, 0, CHASSIS.z + p.z - this.carPivot.position.z);
    this.camera.position.add(moved);
    this.controls.target.add(moved);
    this.applyCarPose();
  }

  /** How far a motor's wheel has turned on the bench, in turns (negative = backwards); for tests. */
  wheelTurns(partId: string): number | undefined {
    return this.views.get(partId)?.turns?.();
  }

  /** Screen position (CSS px, relative to the canvas) of a connection point; for tests and hints. */
  screenOf(id: string): { x: number; y: number } | undefined {
    const p = this.pos(id);
    if (!p) return undefined;
    const v = new THREE.Vector3(p.x, this.connY(id), p.z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
  }

  // ───────────────────────── rendering ─────────────────────────

  private fit(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    // Shift the picture so its centre sits between the side panels instead of under one of them.
    const shift = (this.insets.left - this.insets.right) / 2;
    if (shift) this.camera.setViewOffset(w, h, -shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 0;
      this.lastFrame = this.animating ? now : 0;
      if (this.animating) for (const v of this.views.values()) v.tick?.(dt);
      const moving = this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (moving || this.animating) this.requestRender();
    });
  }

  // ───────────────────────── models ─────────────────────────

  private makeBreadboard(): THREE.Group {
    const g = new THREE.Group();
    const top = canvasTexture(
      BB_W,
      BB_D,
      (c, px) => {
        c.fillStyle = '#f3f1ea';
        c.fillRect(0, 0, BB_W * px, BB_D * px);
        const at = (x: number, z: number) => [(x + BB_W / 2) * px, (z + BB_D / 2) * px] as const;
        // Centre channel.
        c.fillStyle = '#dedad0';
        const [, gz] = at(0, -1.2);
        c.fillRect(0, gz, BB_W * px, 2.4 * px);
        // Rail stripes: red for +, blue for −.
        for (const rail of RAILS) {
          const p = holePosition(`${'bb:'}${rail}1`)!;
          const stripe = rail.endsWith('+') ? '#d32f2f' : '#1e63c4';
          const dz = (rail.startsWith('top') ? -1 : 1) * (rail.endsWith('+') ? 1.6 : -1.6);
          c.fillStyle = stripe;
          const [x0, z0] = at(holePosition('bb:a1')!.x - 2, p.z + dz);
          c.fillRect(x0, z0 - 0.18 * px, (COLUMNS * PITCH) * px, 0.36 * px);
          c.font = `bold ${2.4 * px}px Inter Variable, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          const [lx, lz] = at(-BB_W / 2 + 2, p.z);
          c.fillText(rail.endsWith('+') ? '+' : '−', lx, lz);
        }
        // Holes.
        c.fillStyle = '#2a2a2a';
        const s = 1.0 * px;
        for (const id of allHoles()) {
          const p = holePosition(id)!;
          const [x, z] = at(p.x, p.z);
          c.fillRect(x - s / 2, z - s / 2, s, s);
        }
        // Row letters at both ends, column numbers every 5.
        c.fillStyle = '#6b6f78';
        c.font = `${1.7 * px}px Inter Variable, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (const [i, r] of [...ROWS].entries()) {
          const p = holePosition(`bb:${r}1`)!;
          for (const x of [-BB_W / 2 + 2, BB_W / 2 - 2]) {
            const [lx, lz] = at(x, p.z);
            c.fillText(r, lx, lz);
          }
          void i;
        }
        for (let col = 1; col <= COLUMNS; col += col === 1 ? 4 : 5) {
          for (const r of ['a', 'j']) {
            const p = holePosition(`bb:${r}${col}`)!;
            const [lx, lz] = at(p.x, p.z + (r === 'a' ? -2.4 : 2.4));
            c.fillText(String(col), lx, lz);
          }
        }
      },
      26,
    );
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(BB_W, BB_H, BB_D),
      [
        new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ map: top, roughness: 0.65 }),
        new THREE.MeshStandardMaterial({ color: 0xe9e6dd }),
        new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.7 }),
      ],
    );
    body.position.y = BB_H / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    return g;
  }

  /** A generic microcontroller board: original artwork, with the selected board's pin labels. */
  private rebuildBoard(): void {
    this.disposeGroup(this.boardRoot);
    this.boardRoot.clear();
    if (benchModel(this.board) === 'smrs') {
      const model = buildSmrsBoard(() => this.requestRender());
      model.position.set(0, PCB_Y, BOARD_Z);
      this.boardRoot.add(model);
      this.requestRender();
      return;
    }
    if (benchModel(this.board) === 'malkon-one' && !this.modelFailed) {
      const model = buildMalkonOneBoard(
        () => this.requestRender(),
        (e) => {
          // Without the model file the generic board still shows the pins in the right places.
          console.warn('The Malkon One model did not load:', e);
          this.modelFailed = true;
          this.rebuildBoard();
        },
      );
      model.position.set(0, PCB_Y, BOARD_Z);
      this.boardRoot.add(model);
      return;
    }
    const order = boardPinOrder(this.board);
    const xs = order.map((p) => pinPosition(this.board, `pin:${p}`)!.x);
    const w = Math.max(68.6, Math.max(...xs) - Math.min(...xs) + 16);
    const d = 53.3;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const tex = canvasTexture(
      w,
      d,
      (c, px) => {
        c.fillStyle = '#0b5e58';
        c.fillRect(0, 0, w * px, d * px);
        c.strokeStyle = '#0f7a71';
        c.lineWidth = 0.5 * px;
        for (let i = 0; i < 6; i++) {
          c.beginPath();
          c.moveTo((8 + i * 4) * px, 6 * px);
          c.lineTo((8 + i * 4) * px, (d - 20) * px);
          c.lineTo((w - 30 + i * 2) * px, (d - 20) * px);
          c.stroke();
        }
        c.fillStyle = '#e8f3f1';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = `bold ${4 * px}px Inter Variable, sans-serif`;
        c.fillText(this.board.name.replace(/\s*\(.*\)$/, ''), (w / 2) * px, (d / 2 - 4) * px);
        // Pin labels just behind the header (the header row is near the front edge).
        c.font = `bold ${1.55 * px}px Inter Variable, sans-serif`;
        for (const p of order) {
          const pos = pinPosition(this.board, `pin:${p}`)!;
          c.fillStyle = p === '5V' ? '#ff8a80' : p === 'GND' ? '#b0bec5' : '#ffffff';
          c.fillText(p, (pos.x - cx + w / 2) * px, (pos.z - BOARD_Z + d / 2 - 3.6) * px);
        }
      },
      22,
    );
    const pcb = new THREE.Mesh(
      new THREE.BoxGeometry(w, PCB_T, d),
      [0, 0, 0, 0, 0, 0].map((_, i) => new THREE.MeshStandardMaterial(i === 2 ? { map: tex, roughness: 0.55 } : { color: 0x0a4c47, roughness: 0.6 })),
    );
    pcb.position.set(cx, PCB_Y + PCB_T / 2, BOARD_Z);
    pcb.castShadow = true;
    pcb.receiveShadow = true;
    this.boardRoot.add(pcb);
    // Standoffs, chip, USB socket, power jack.
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, color: number, metal = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: metal ? 0.35 : 0.6 }));
      m.position.set(x, y, z);
      m.castShadow = true;
      this.boardRoot.add(m);
      return m;
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(3, PCB_Y, 3, cx + sx * (w / 2 - 4), PCB_Y / 2, BOARD_Z + sz * (d / 2 - 4), 0xbbbbbb, 0.6);
    box(34, 3.2, 8.5, cx + 6, PCB_Y + PCB_T + 1.6, BOARD_Z + 6, 0x161616);
    box(12, 11, 16, cx - w / 2 + 5, PCB_Y + PCB_T + 5.5, BOARD_Z - d / 2 + 9, 0xc8ccd2, 0.85);
    box(9, 11, 13, cx - w / 2 + 5, PCB_Y + PCB_T + 5.5, BOARD_Z + d / 2 - 12, 0x1a1a1a);
    // Header strips with gold pins (one strip per group of pins).
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 });
    const pinGeo = new THREE.BoxGeometry(0.64, 0.4, 0.64);
    for (const p of order) {
      const pos = pinPosition(this.board, `pin:${p}`)!;
      const housing = box(PITCH, HEADER_H, PITCH * 0.95, pos.x, PCB_Y + PCB_T + HEADER_H / 2, pos.z, 0x111111);
      housing.userData['pin'] = p;
      const g = new THREE.Mesh(pinGeo, gold);
      g.position.set(pos.x, PIN_TOP - 0.15, pos.z);
      this.boardRoot.add(g);
    }
    this.requestRender();
  }

  private legMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.9, roughness: 0.3 });

  private makePart(p: PlacedPart): PartView {
    const group = new THREE.Group();
    const materials: THREE.MeshStandardMaterial[] = [];
    const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });
      materials.push(m);
      return m;
    };
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.userData['partId'] = p.id;
      group.add(mesh);
      return mesh;
    };
    const legs = PART_KINDS[p.kind].legs.map((l) => l.offset * PITCH);
    const span = legs[legs.length - 1]!;
    const leg = (x: number, height: number) => add(new THREE.CylinderGeometry(0.25, 0.25, height, 8), this.legMaterial, x, BB_H + height / 2, 0);
    let update: PartView['update'] = () => {};

    switch (p.kind) {
      case 'led': {
        const colour = LED_COLOURS[p.colour ?? 'red'] ?? 0xff2a1f;
        for (const x of legs) leg(x, 3.2);
        const lensMat = mat(colour, { transparent: true, opacity: 0.82, roughness: 0.15, emissive: colour, emissiveIntensity: 0.05 });
        const cx = span / 2;
        add(new THREE.CylinderGeometry(2.7, 2.7, 0.9, 32), lensMat, cx, BB_H + 3.6, 0);
        add(new THREE.CylinderGeometry(2.45, 2.45, 4.2, 32), lensMat, cx, BB_H + 6.1, 0);
        add(new THREE.SphereGeometry(2.45, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), lensMat, cx, BB_H + 8.2, 0);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: colour, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
        glow.position.set(cx, BB_H + 7, 0);
        glow.scale.setScalar(22);
        group.add(glow);
        update = (s) => {
          const level = s?.level ?? 0;
          lensMat.emissiveIntensity = 0.05 + level * 2.6;
          lensMat.opacity = 0.82 + level * 0.15;
          glow.material.opacity = level * 0.85;
          glow.scale.setScalar(14 + level * 16);
        };
        break;
      }
      case 'resistor': {
        // Leads come up from both holes and bend over to the body.
        for (const x of legs) leg(x, 3.5);
        add(new THREE.CylinderGeometry(0.25, 0.25, span, 8).rotateZ(Math.PI / 2), this.legMaterial, span / 2, BB_H + 3.5, 0);
        const bodyLen = 6.3;
        add(new THREE.CapsuleGeometry(1.15, bodyLen - 2.3, 6, 16).rotateZ(Math.PI / 2), mat(0xe2c79a), span / 2, BB_H + 3.5, 0);
        resistorBands(p.ohms ?? 220).forEach((c, i) => {
          const band = add(new THREE.CylinderGeometry(1.2, 1.2, 0.55, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }), span / 2 - 2.2 + i * 1.25 + (i === 3 ? 0.6 : 0), BB_H + 3.5, 0);
          band.castShadow = false;
        });
        break;
      }
      case 'button': {
        for (const x of legs) leg(x, 1);
        add(new THREE.BoxGeometry(6, 3.4, 6), mat(0x1c1c1c), span / 2, BB_H + 1.7, 0);
        const cap = add(new THREE.CylinderGeometry(1.8, 1.8, 1.6, 24), mat(0x9a9fa6), span / 2, BB_H + 4.2, 0);
        update = (s) => {
          cap.position.y = BB_H + ((s?.input ?? 0) >= 0.5 ? 3.6 : 4.2);
        };
        break;
      }
      case 'switch': {
        for (const x of legs) leg(x, 1);
        add(new THREE.BoxGeometry(span + 3.5, 3.6, 3.6), mat(0x2b5fb6), span / 2, BB_H + 1.8, 0);
        const knob = add(new THREE.BoxGeometry(1.6, 2.6, 1.6), mat(0x1a1a1a), span / 2, BB_H + 4.6, 0);
        update = (s) => {
          knob.position.x = span / 2 + ((s?.input ?? 0) >= 0.5 ? -1.2 : 1.2);
        };
        break;
      }
      case 'potentiometer': {
        for (const x of legs) leg(x, 1);
        add(new THREE.BoxGeometry(span + 4.5, 5, 6.5), mat(0x2463c9), span / 2, BB_H + 2.5, -0.8);
        add(new THREE.CylinderGeometry(2.6, 2.6, 1.6, 24), mat(0xb9bdc4, { metalness: 0.6 }), span / 2, BB_H + 5.8, -0.8);
        const knob = new THREE.Group();
        knob.position.set(span / 2, BB_H + 6.6, -0.8);
        const k = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 4, 24), mat(0xf0f0f0));
        k.position.y = 2;
        k.castShadow = true;
        k.userData['partId'] = p.id;
        const tick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 1.8), new THREE.MeshBasicMaterial({ color: 0xe50914 }));
        tick.position.set(0, 4.05, -1.1);
        knob.add(k, tick);
        group.add(knob);
        update = (s) => {
          knob.rotation.y = THREE.MathUtils.degToRad(135 - (s?.input ?? 0.5) * 270);
        };
        break;
      }
      case 'buzzer': {
        for (const x of legs) leg(x, 1);
        const body = add(new THREE.CylinderGeometry(6, 6, 7.5, 40), mat(0x161616), span / 2, BB_H + 4.75, 0);
        add(new THREE.CylinderGeometry(1, 1, 0.2, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }), span / 2, BB_H + 8.55, 0);
        const ring = new THREE.Mesh(new THREE.RingGeometry(6.5, 7.3, 40), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(span / 2, BB_H + 8.7, 0);
        group.add(ring);
        update = (s) => {
          const on = (s?.level ?? 0) > 0;
          ring.material.opacity = on ? 0.8 : 0;
          body.scale.set(on ? 1.03 : 1, 1, on ? 1.03 : 1);
        };
        break;
      }
    }
    let tick: PartView['tick'];
    let turns: PartView['turns'];
    if (p.kind === 'dc-motor') {
      // On the breadboard: the motor lies in front of it and its wires run to the two holes, drawn
      // relative to the first hole so dragging the part moves it like any other. On a screw
      // terminal: it lies beside the board, its wires going into the side of the terminal block.
      const legs = legHoles(p) ?? [`bb:${ROWS[p.row]}${p.col}`, `bb:${ROWS[p.row]}${p.col + 1}`];
      const onTerminal = !!p.terminal && legs.every((h) => this.basePos(h));
      const ends = legs.map((h) => {
        const at = this.basePos(h) ?? { x: 0, z: 0 };
        return new THREE.Vector3(at.x, onTerminal ? this.connY(h) : BB_H, at.z);
      });
      const first = onTerminal ? new THREE.Vector3() : new THREE.Vector3(ends[0]!.x, 0, ends[0]!.z);
      const rel = ends.map((e) => e.clone().sub(first));
      const midX = (rel[0]!.x + rel[1]!.x) / 2;
      const midZ = (rel[0]!.z + rel[1]!.z) / 2;
      group.position.copy(first);
      const onModel = (root: THREE.Object3D) => {
        root.traverse((o) => {
          o.userData['partId'] = p.id;
          // The placement preview is see-through.
          const m = o as THREE.Mesh;
          if (p.id === 'ghost' && m.isMesh) {
            m.material = (m.material as THREE.MeshStandardMaterial).clone();
            Object.assign(m.material, { transparent: true, opacity: 0.55, depthWrite: false });
          }
        });
        this.applySelection();
      };
      // With a robot car on the bench, a motor on the board's terminal is the car's own motor on that side.
      const car = onTerminal && p.id !== 'ghost' ? this.chassis : undefined;
      const side = p.terminal ?? 'A';
      const motor = car
        ? {
            ...car.terminals(side),
            setSpeed: (v: number) => car.setSpeed(side, v),
            spin: (v: number, dt: number) => car.spin(side, v, dt),
            turns: () => car.turns(side),
          }
        : onTerminal
          ? // Beside the board: Motor A towards the breadboard, Motor B behind it, wheels outwards.
            buildMotor(midX + 14, midZ + (p.terminal === 'A' ? 30 : -30), 1, onModel)
          : buildMotor(midX, BB_D / 2 + 36 - first.z, first.x + midX > 0 ? -1 : 1, onModel);
      if ('group' in motor) group.add(motor.group);
      const lead = (from: THREE.Vector3, to: THREE.Vector3, colour: number) => {
        // Into a breadboard hole from above, or into the side of a screw terminal. On the car the
        // wires come up from the motor under the deck, beside the board, into the terminal.
        const pts = car
          ? [from, new THREE.Vector3(from.x * 0.9, CHASSIS.deckHeight - 3, from.z), new THREE.Vector3(42, to.y + 3, (from.z + to.z) / 2), new THREE.Vector3(to.x + 3, to.y, to.z), new THREE.Vector3(to.x - 1, to.y, to.z)]
          : onTerminal
          ? [from, new THREE.Vector3((from.x + to.x) / 2, Math.max(from.y, to.y) + 4, (from.z + to.z) / 2), new THREE.Vector3(to.x + 3, to.y, to.z), new THREE.Vector3(to.x - 1, to.y, to.z)]
          : [
              from,
              new THREE.Vector3((from.x + to.x) / 2, Math.max(from.y, BB_H) + 8, (from.z + to.z) / 2),
              new THREE.Vector3(to.x, BB_H + 6, to.z),
              new THREE.Vector3(to.x, BB_H - 1.5, to.z),
            ];
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
        add(new THREE.TubeGeometry(curve, 40, 0.55, 8, false), mat(colour, { roughness: 0.45 }), 0, 0, 0);
      };
      lead(motor.red, rel[0]!, 0xd32f2f);
      lead(motor.black, rel[1]!, 0x222222);
      let speed = 0;
      update = (s) => {
        speed = s?.level ?? 0;
        motor.setSpeed(speed);
      };
      tick = (dt) => motor.spin(speed, dt);
      turns = () => motor.turns();
    } else if (p.kind === 'chassis') {
      const car = buildChassis((root) => {
        root.traverse((o) => (o.userData['partId'] = p.id));
        this.applySelection();
      });
      group.add(car.group);
      if (p.id !== 'ghost') {
        this.chassis = car;
        tick = (dt) => this.driveCar(car, dt);
      }
    } else {
      const first = holePosition(legHoles(p)?.[0] ?? `bb:${ROWS[p.row]}${p.col}`) ?? { x: 0, z: 0 };
      group.position.set(first.x, 0, first.z);
      group.rotation.y = p.rotation === 90 ? -Math.PI / 2 : 0;
    }
    group.userData['partId'] = p.id;
    return { group, materials, update, ...(tick ? { tick } : {}), ...(turns ? { turns } : {}) };
  }

  private rebuildWires(select = true): void {
    for (const m of this.wireMeshes.values()) this.disposeGroup(m);
    this.wireMeshes.clear();
    this.wiresRoot.clear();
    for (const w of this.layout.wires) {
      const mesh = this.makeWire(w.from, w.to, w.colour);
      if (!mesh) continue;
      mesh.userData['wireId'] = w.id;
      this.wireMeshes.set(w.id, mesh);
      this.wiresRoot.add(mesh);
    }
    if (select) this.applySelection();
  }

  private makeWire(from: string, to: string, colour: string): THREE.Mesh | undefined {
    const a = this.pos(from);
    const b = this.pos(to);
    if (!a || !b) return undefined;
    const ya = this.connY(from);
    const yb = this.connY(to);
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const lift = Math.min(4 + dist * 0.28, 32);
    // Straight up out of each hole, then a smooth arc between them, as a jumper wire lies.
    const pts = [
      new THREE.Vector3(a.x, ya - 1.5, a.z),
      new THREE.Vector3(a.x, ya + lift * 0.5, a.z),
      new THREE.Vector3(a.x + (b.x - a.x) * 0.5, Math.max(ya, yb) + lift, a.z + (b.z - a.z) * 0.5),
      new THREE.Vector3(b.x, yb + lift * 0.5, b.z),
      new THREE.Vector3(b.x, yb - 1.5, b.z),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.55, 10, false), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45 }));
    mesh.castShadow = true;
    return mesh;
  }

  private selectionBox: THREE.LineSegments | undefined;

  /** A red outline around the selected part; a selected wire glows. */
  private applySelection(): void {
    if (this.selectionBox) {
      this.selectionBox.removeFromParent();
      this.selectionBox.geometry.dispose();
      this.selectionBox = undefined;
    }
    const view = this.selected ? this.views.get(this.selected) : undefined;
    if (view) {
      // Measured in the frame the part lives in, so the outline of a part on the car rides along with it.
      const frame = view.group.parent === this.carParts ? this.carInner : this.scene;
      frame.updateWorldMatrix(true, true);
      const toFrame = frame.matrixWorld.clone().invert();
      // Only what is drawn: a model may carry hidden pieces (the motor's own loose leads).
      const box = new THREE.Box3();
      view.group.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(toFrame.clone().multiply(m.matrixWorld)));
      });
      if (!box.isEmpty()) {
        box.expandByScalar(0.8);
        const size = box.getSize(new THREE.Vector3());
        this.selectionBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color: 0xe50914 }));
        this.selectionBox.position.copy(box.getCenter(new THREE.Vector3()));
        frame.add(this.selectionBox);
      }
    }
    for (const [id, mesh] of this.wireMeshes) (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(id === this.selected ? 0x666666 : 0x000000);
    this.updateParts();
  }

  private updateParts(): void {
    let anim = false;
    for (const [id, v] of this.views) {
      const s = this.state?.parts[id];
      v.update(s, this.running);
      const kind = this.layout.parts.find((p) => p.id === id)?.kind;
      if ((kind === 'buzzer' || kind === 'dc-motor') && (s?.level ?? 0) !== 0) anim = true;
    }
    this.animating = anim;
    this.requestRender();
  }

  private removeGhost(): void {
    if (!this.ghost) return;
    this.scene.remove(this.ghost);
    this.disposeGroup(this.ghost);
    this.ghost = undefined;
  }

  private disposeGroup(g: THREE.Object3D): void {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  // ───────────────────────── pointer interaction ─────────────────────────

  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** The connection point under the pointer: a board pin, or the nearest breadboard hole. */
  private connectionAt(e: PointerEvent): string | undefined {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hit = (y: number) => {
      const p = new THREE.Vector3();
      return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : undefined;
    };
    const atPins = this.boardRoot.visible ? hit(PIN_TOP + this.place.lift) : undefined;
    if (atPins) {
      // The nearest pin, close enough to be meant (headers with two rows have pins on both sides).
      let best: string | undefined;
      let bestD = Infinity;
      for (const pin of benchConnectors(this.board)) {
        const pos = this.pinPos(`pin:${pin}`)!;
        const dx = Math.abs(pos.x - atPins.x);
        const dz = Math.abs(pos.z - atPins.z);
        if (dx < PITCH * 0.55 && dz < PITCH * 0.9 && dx + dz < bestD) {
          bestD = dx + dz;
          best = `pin:${pin}`;
        }
      }
      if (best) return best;
    }
    const atBoard = this.breadboardGroup.visible ? hit(BB_H) : undefined;
    return atBoard ? nearestHole(atBoard.x, atBoard.z) : undefined;
  }

  private objectAt(e: PointerEvent): { partId?: string; wireId?: string } {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects([this.partsRoot, this.carParts, this.wiresRoot], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData['partId']) return { partId: o.userData['partId'] as string };
        if (o.userData['wireId']) return { wireId: o.userData['wireId'] as string };
        o = o.parent;
      }
    }
    return {};
  }

  /** The name of the board part under the pointer (chips, terminals, headers), if any. */
  private boardPartAt(e: PointerEvent): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hit = this.raycaster.intersectObject(this.boardRoot, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData['label']) o = o.parent;
    return (o?.userData['label'] as string | undefined) ?? null;
  }

  private partAtHole(hole: string | undefined): string | undefined {
    if (!hole) return undefined;
    return this.layout.parts.find((p) => legHoles(p)?.includes(hole))?.id;
  }

  /** Where a part would go if its first leg were in this hole. */
  private spotFor(hole: string | undefined): { row: number; col: number } | undefined {
    return hole ? parseHole(hole) : undefined;
  }

  private showMarker(id: string | undefined, ok: boolean): void {
    if (!id) {
      this.marker.visible = false;
      return;
    }
    const p = this.pos(id)!;
    this.marker.position.set(p.x, this.connY(id) + 0.05, p.z);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x3fb950 : 0xff5252);
    this.marker.visible = true;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const hit = this.objectAt(e);
    // A small part is easy to miss: the holes its legs sit in pick it too.
    const partId = hit.partId ?? (hit.wireId ? undefined : this.partAtHole(this.connectionAt(e)));
    const wireId = hit.wireId;
    if (this.mode.kind === 'probe') {
      // Decided on release, so dragging to look around does not place a probe.
      this.downAt = { x: e.clientX, y: e.clientY, partId, wireId };
      return;
    }
    if (this.running && partId) {
      const kind = this.layout.parts.find((p) => p.id === partId)?.kind;
      if (kind === 'button') {
        this.pressed = partId;
        this.events.operate(partId, 1);
        this.controls.enabled = false;
        return;
      }
      if (kind === 'switch') {
        this.events.operate(partId, (this.state?.parts[partId]?.input ?? 0) >= 0.5 ? 0 : 1);
        return;
      }
    }
    const onTerminal = !!this.layout.parts.find((p) => p.id === partId)?.terminal;
    if (this.mode.kind === 'select' && partId && !this.running && !onTerminal) {
      // Start a possible drag; a click without movement just selects.
      this.drag = { id: partId, startX: e.clientX, startY: e.clientY, moved: false };
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.events.select(partId);
      return;
    }
    if (this.mode.kind === 'select') {
      // Selection happens on release, so orbiting does not lose the current selection.
      this.downAt = { x: e.clientX, y: e.clientY, partId, wireId };
    }
  };

  private downAt: { x: number; y: number; partId?: string | undefined; wireId?: string | undefined } | null = null;

  private onMove = (e: PointerEvent): void => {
    if (this.drag) {
      if (Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) > 4) this.drag.moved = true;
      if (!this.drag.moved) return;
      const part = this.layout.parts.find((p) => p.id === this.drag!.id);
      const spot = this.spotFor(this.connectionAt(e));
      const view = this.views.get(this.drag.id);
      if (!part || !view) return;
      if (spot) {
        const ok = this.events.canPlace({ kind: part.kind, row: spot.row, col: spot.col, rotation: part.rotation }, part.id);
        const pos = holePosition(`bb:${ROWS[spot.row]}${spot.col}`)!;
        view.group.position.set(pos.x, ok ? 2 : 3, pos.z);
        this.drag.target = ok ? spot : undefined;
        this.showMarker(`bb:${ROWS[spot.row]}${spot.col}`, ok);
      }
      this.requestRender();
      return;
    }
    const conn = this.connectionAt(e);
    if (this.mode.kind === 'place' && this.ghost) {
      const spot = this.spotFor(conn);
      if (spot) {
        const ok = this.events.canPlace({ kind: this.mode.part, ...spot, rotation: this.rotation });
        const pos = holePosition(`bb:${ROWS[spot.row]}${spot.col}`)!;
        this.ghost.position.set(pos.x, 0, pos.z);
        this.ghost.rotation.y = this.rotation === 90 ? -Math.PI / 2 : 0;
        this.ghost.visible = true;
        this.showMarker(conn, ok);
      } else {
        this.ghost.visible = false;
        this.showMarker(undefined, false);
      }
    } else if (this.mode.kind === 'wire') {
      this.showMarker(conn, !!conn && conn !== this.wireStart);
    } else if (this.mode.kind === 'probe') {
      this.showMarker(conn, !!conn);
    } else {
      this.marker.visible = false;
    }
    this.events.hover(conn ? `${conn.startsWith('pin:') ? (isMotorTerminal(conn.slice(4)) ? motorTerminalName(conn.slice(4)) : `Pin ${canonicalPin(conn.slice(4))}`) : describeHole(conn)} · ${this.events.describe(conn)}` : this.boardPartAt(e));
    this.requestRender();
  };

  private onUp = (e: PointerEvent): void => {
    this.controls.enabled = true;
    if (this.pressed) {
      this.events.operate(this.pressed, 0);
      this.pressed = null;
      return;
    }
    if (this.drag) {
      const { id, moved, target } = this.drag;
      this.drag = null;
      this.marker.visible = false;
      if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
      if (moved && target) this.events.move(id, target.row, target.col);
      else this.setLayout(this.layout); // snap back
      return;
    }
    const conn = this.connectionAt(e);
    if (this.mode.kind === 'place') {
      const spot = this.spotFor(conn);
      if (spot && this.events.canPlace({ kind: this.mode.part, ...spot, rotation: this.rotation })) this.events.place(this.mode.part, spot.row, spot.col, this.rotation);
      return;
    }
    if (this.mode.kind === 'probe') {
      const down = this.downAt;
      this.downAt = null;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) this.events.probe(conn, down.partId);
      return;
    }
    if (this.mode.kind === 'wire') {
      if (!conn) return;
      if (!this.wireStart) {
        this.wireStart = conn;
        const p = this.pos(conn)!;
        this.startMarker.position.set(p.x, this.connY(conn) + 0.06, p.z);
        this.startMarker.visible = true;
      } else if (conn !== this.wireStart) {
        this.events.wire(this.wireStart, conn);
        this.wireStart = null;
        this.startMarker.visible = false;
      }
      this.requestRender();
      return;
    }
    const down = this.downAt;
    this.downAt = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) this.events.select(down.partId ?? down.wireId ?? null);
  };

  private onLeave = (): void => {
    this.marker.visible = false;
    if (this.ghost) this.ghost.visible = false;
    this.events.hover(null);
    this.requestRender();
  };
}

function describeHole(id: string): string {
  const term = parseHole(id);
  if (term) return `Hole ${ROWS[term.row]}${term.col}`;
  const rail = /^bb:(top|bot)([+-])/.exec(id);
  return rail ? `${rail[1] === 'top' ? 'Top' : 'Bottom'} ${rail[2] === '+' ? '+' : '−'} rail` : id;
}

let glow: THREE.Texture | undefined;
function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glow = new THREE.CanvasTexture(c);
  return glow;
}
