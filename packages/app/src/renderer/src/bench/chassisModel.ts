/**
 * The robot car chassis on the workbench, from Omorfo Tech Labs' model (robot-chassis.glb:
 * millimetres inside a 1/1000 root, every part named in `extras.label`): an aluminium deck with side
 * plates, a ball caster at the front, and two TT gear motors underneath with their wheels at the back.
 *
 * Model frame: the deck's top at y = 0, the front (caster, bumper) towards −z, the left motor at
 * x = −38.6 and the right one at +38.6, wheel axles at y = −14.5, z = 40. The lowest point (wheels and
 * caster) is at y = −48.2, so the chassis stands on the table when lifted by `CHASSIS.deckHeight`.
 * The left motor is Motor A and the right one Motor B, as on the Tariro robot.
 */
import * as THREE from 'three';
import { CHASSIS } from '@tariro-studio/core';
import modelUrl from '../assets/parts/robot-chassis.glb?url';
import { loadGlb } from './glb';

export type Side = 'A' | 'B';

/** Fastest wheel speed (turns a second), as for the loose TT motor: a 1:48 TT motor at 5 V. */
export const WHEEL_TURNS_PER_SECOND = 2.5;
/** The wheels: 65 mm across, their centres 126 mm apart (x = ±63 in the model). */
export const WHEEL_DIAMETER = 65;
export const WHEEL_TRACK = 126;
const MAX_TURNS_PER_SECOND = WHEEL_TURNS_PER_SECOND;
/**
 * The motor terminals in the model frame. Each motor assembly is the TT motor model placed at
 * x = ∓38.6, y = −14.5 with its gearbox pointing to the back; its terminals (red at +7.2, black at
 * −7.2 across the motor, 57.6 along it) therefore come out under the deck towards the front.
 */
const TERMINALS: Record<Side, { red: THREE.Vector3; black: THREE.Vector3 }> = {
  A: { red: new THREE.Vector3(-38.6, -7.3, -17.6), black: new THREE.Vector3(-38.6, -21.7, -17.6) },
  B: { red: new THREE.Vector3(38.6, -7.3, -17.6), black: new THREE.Vector3(38.6, -21.7, -17.6) },
};

export interface ChassisView {
  /** Positioned in bench coordinates. */
  group: THREE.Group;
  /** Where a motor's red (+) and black (−) wires leave it, in bench coordinates. */
  terminals(side: Side): { red: THREE.Vector3; black: THREE.Vector3 };
  /** Show which way a motor pushes the car (green arrow forward, orange backwards, none when stopped). */
  setSpeed(side: Side, speed: number): void;
  /** The speed a motor was last set to, −1…1. */
  speed(side: Side): number;
  /** Turn a wheel: `speed` −1…1 (positive drives the car forward), `dt` in seconds. */
  spin(side: Side, speed: number, dt: number): void;
  /** How far a wheel has turned, in turns (positive = rolling forward); for tests. */
  turns(side: Side): number;
}

export function buildChassis(onReady: (root: THREE.Object3D) => void): ChassisView {
  const group = new THREE.Group();
  group.position.set(0, CHASSIS.deckHeight, CHASSIS.z);
  const wheels: Partial<Record<Side, { node: THREE.Object3D; sign: number }>> = {};
  const angle: Record<Side, number> = { A: 0, B: 0 };
  const speeds: Record<Side, number> = { A: 0, B: 0 };

  // A straight arrow beside each wheel, pointing the way that motor pushes the car.
  const arrows = {} as Record<Side, { group: THREE.Group; mat: THREE.MeshBasicMaterial }>;
  for (const side of ['A', 'B'] as const) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x2e9d4a, transparent: true, opacity: 0.9, depthTest: false });
    const a = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 34, 12), mat);
    shaft.rotation.x = Math.PI / 2; // along z
    const head = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 16), mat);
    head.rotation.x = -Math.PI / 2; // points to −z: forward
    head.position.z = -21;
    for (const m of [shaft, head]) m.renderOrder = 5;
    a.add(shaft, head);
    // Over the wheel (its top is at y = 19), where it is seen from the usual view.
    a.position.set(side === 'A' ? -63 : 63, 30, 40);
    a.visible = false;
    group.add(a);
    arrows[side] = { group: a, mat };
  }

  loadGlb(modelUrl).then(
    (scene) => {
      const copy = scene.clone(true);
      copy.scale.setScalar(1000);
      group.add(copy);
      group.updateWorldMatrix(true, true);
      // The two wheels: the left one (negative x) is Motor A's.
      const found: THREE.Object3D[] = [];
      copy.traverse((o) => {
        if (/^Wheel \(/.test((o.userData['label'] as string | undefined) ?? '')) found.push(o.children[0]!);
      });
      for (const node of found) {
        const centre = node.getWorldPosition(new THREE.Vector3());
        const side: Side = group.worldToLocal(centre.clone()).x < 0 ? 'A' : 'B';
        // Which way a positive turn of this node rolls the wheel: follow the top of the tyre for a moment.
        const top = node.worldToLocal(centre.clone().add(new THREE.Vector3(0, 30, 0)));
        const before = node.localToWorld(top.clone());
        node.rotation.x += 0.01;
        node.updateWorldMatrix(true, false);
        const after = node.localToWorld(top.clone());
        node.rotation.x -= 0.01;
        node.updateWorldMatrix(true, false);
        // Rolling forward, the top of a wheel moves forwards (−z), like the car.
        wheels[side] = { node, sign: after.z - before.z < 0 ? 1 : -1 };
      }
      onReady(copy);
    },
    (e: unknown) => console.warn('The chassis model did not load:', e),
  );

  return {
    group,
    terminals(side) {
      // The chassis group sits directly on the bench (its parents are at the origin), and may not be in the scene yet.
      group.updateMatrix();
      const t = TERMINALS[side];
      return { red: t.red.clone().applyMatrix4(group.matrix), black: t.black.clone().applyMatrix4(group.matrix) };
    },
    setSpeed(side, speed) {
      speeds[side] = speed;
      const a = arrows[side];
      a.group.visible = speed !== 0;
      a.mat.color.setHex(speed > 0 ? 0x2e9d4a : 0xef6c00);
      a.group.rotation.y = speed < 0 ? Math.PI : 0;
    },
    spin(side, speed, dt) {
      angle[side] += speed * MAX_TURNS_PER_SECOND * Math.PI * 2 * dt;
      const w = wheels[side];
      if (w) w.node.rotation.x = w.sign * angle[side];
    },
    turns: (side) => angle[side] / (Math.PI * 2),
    speed: (side) => speeds[side],
  };
}
