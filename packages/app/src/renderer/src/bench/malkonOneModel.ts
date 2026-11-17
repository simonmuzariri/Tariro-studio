/**
 * The Malkon One board in 3D: Omorfo Tech Labs' own model of the board (malkon-one.glb, a glTF
 * file in metres, every part named in `extras.label`). Loaded once and shared; each workbench gets
 * its own copy (see glb.ts). Turned on the bench as `MALKON_ONE_TURN` says, so its pins line up with
 * `MALKON_ONE_PINS` in core.
 */
import * as THREE from 'three';
import { MALKON_ONE_TURN } from '@tariro-studio/core';
import modelUrl from '../assets/boards/malkon-one.glb?url';
import { loadGlb } from './glb';

/**
 * A group in millimetres, the PCB's underside at y = 0, that fills with the board when the model
 * has loaded (then `onReady` is called, to draw it).
 */
export function buildMalkonOneBoard(onReady: () => void, onError: (e: unknown) => void): THREE.Group {
  const group = new THREE.Group();
  group.rotation.y = MALKON_ONE_TURN;
  loadGlb(modelUrl).then(
    (scene) => {
      const copy = scene.clone(true);
      copy.scale.setScalar(1000); // metres → millimetres (the file's root also scales by 1/1000)
      group.add(copy);
      onReady();
    },
    (e: unknown) => onError(e),
  );
  return group;
}
