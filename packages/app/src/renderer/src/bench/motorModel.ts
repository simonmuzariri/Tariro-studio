/**
 * The yellow "TT" gear motor with its 65 mm wheel on the workbench, from Omorfo Tech Labs' model
 * (tt-motor-wheel.glb: millimetres inside a 1/1000 root, every part named in `extras.label`).
 *
 * In the model the shaft runs along x (the wheel at x = −24.6), the gearbox runs along z (wheel at
 * z = 0, motor terminals at z ≈ 57: red at y = +7.2, black at y = −7.2). On the bench the motor
 * lies on its side in front of the breadboard, wheel on top, so the spinning wheel is easy to see,
 * with its terminals towards the holes its wires are plugged into. The model's own loose leads
 * are hidden; the bench draws the red and black wires to the holes instead.
 */
import * as THREE from 'three';
import modelUrl from '../assets/parts/tt-motor-wheel.glb?url';
import { loadGlb } from './glb';

/** Model: from the wheel centre to the motor terminals along the gearbox, and between the two. */
const TERMINAL_Z = 57;
const TERMINAL_Y = 7.2;
/** Lying on its side, the gearbox's lower face is this far below the shaft. */
const REST_HEIGHT = 11;
/** Fastest wheel speed in the picture (turns a second): a 1:48 TT motor at 5 V is about 2–3. */
const MAX_TURNS_PER_SECOND = 2.5;

export interface MotorView {
  /** Positioned in bench coordinates (not inside a rotated part group). */
  group: THREE.Group;
  /** Where the red (+) and black (−) wires leave the motor, bench coordinates. */
  red: THREE.Vector3;
  black: THREE.Vector3;
  /** Turn the wheel: `speed` −1…1 (negative = backwards), `dt` in seconds. */
  spin(speed: number, dt: number): void;
  /** Show which way the motor is turning (a green arrow forward, an orange one backwards, none when stopped). */
  setSpeed(speed: number): void;
  /** How far the wheel has turned since it was drawn, in turns (negative = backwards); for tests. */
  turns(): number;
}

/**
 * A motor whose terminals sit at (`x`, `z` ± 7.2); the body extends towards the centre of the
 * bench (`towards` = +1 to the right, −1 to the left). The model appears when it has loaded.
 */
export function buildMotor(x: number, z: number, towards: 1 | -1, onReady: (root: THREE.Object3D) => void): MotorView {
  const group = new THREE.Group();
  const d = towards;
  // Model axes → bench: x (shaft) → down, so the wheel is on top; y → d·z; z (wheel → terminals) → −d·x.
  const turn = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, d), new THREE.Vector3(-d, 0, 0));
  const wheelX = x + d * TERMINAL_Z;
  group.position.set(wheelX, REST_HEIGHT, z);
  group.quaternion.setFromRotationMatrix(turn);

  let wheel: THREE.Object3D | undefined;
  let angle = 0;
  let current = 0;
  // A curved arrow over the wheel, in the wheel's frame (so it points the way the wheel turns) but not turning with it.
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x2e9d4a, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false });
  const arrow = new THREE.Group();
  {
    const r = 37;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 1.3, 8, 40, (Math.PI * 2) / 3), arrowMat);
    // Torus arcs run from +x towards +y. Turned a quarter about y the arc lies in the wheel's y–z plane
    // (from −90° to +30° round the wheel's own x), then a twelfth about x centres it: −60° … +60°.
    arc.rotation.y = Math.PI / 2;
    arc.rotation.x = Math.PI / 6;
    const head = new THREE.Mesh(new THREE.ConeGeometry(3.4, 8, 16), arrowMat);
    const end = Math.PI / 3; // the arc ends at +60°, heading in the direction of a positive turn
    head.position.set(0, r * Math.cos(end), r * Math.sin(end));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -Math.sin(end), Math.cos(end)));
    arrow.add(arc, head);
    arrow.position.x = 17; // just past the tyre's outer face, which is upwards on the bench
    arrow.visible = false;
    arrow.renderOrder = 5;
    for (const m of [arc, head]) m.renderOrder = 5;
  }
  const showSpeed = () => {
    arrow.visible = current !== 0;
    arrowMat.color.setHex(current > 0 ? 0x2e9d4a : 0xef6c00);
    arrow.scale.z = current < 0 ? -1 : 1; // mirrored: the arrow points the other way round
  };
  loadGlb(modelUrl).then(
    (scene) => {
      const copy = scene.clone(true);
      copy.scale.setScalar(1000);
      copy.traverse((o) => {
        const label = o.userData['label'] as string | undefined;
        if (label && /lead/i.test(label)) o.visible = false;
        // The whole wheel (tyre and rim) turns: its group's one child. ('Wheel rim / hub' is a part of it.)
        if (label && /^Wheel \(/.test(label)) {
          wheel = o.children[0];
          o.add(arrow);
        }
      });
      group.add(copy);
      onReady(copy);
    },
    (e: unknown) => console.warn('The motor model did not load:', e),
  );

  return {
    group,
    red: new THREE.Vector3(x, REST_HEIGHT, z + d * TERMINAL_Y),
    black: new THREE.Vector3(x, REST_HEIGHT, z - d * TERMINAL_Y),
    spin(speed, dt) {
      if (!wheel) return;
      angle += speed * MAX_TURNS_PER_SECOND * Math.PI * 2 * dt;
      wheel.rotation.x = angle;
    },
    setSpeed(speed) {
      current = speed;
      showSpeed();
    },
    turns: () => angle / (Math.PI * 2),
  };
}
