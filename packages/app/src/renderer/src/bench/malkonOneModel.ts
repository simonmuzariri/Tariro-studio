/**
 * The Malkon One board in 3D: Omorfo Tech Labs' own model of the board (malkon-one.glb, a glTF
 * file in metres, every part named in `extras.label`). Loaded once and shared; each workbench gets
 * its own copy. Turned on the bench as `MALKON_ONE_TURN` says, so its pins line up with
 * `MALKON_ONE_PINS` in core.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MALKON_ONE_TURN } from '@tariro-studio/core';
import modelUrl from '../assets/boards/malkon-one.glb?url';

let loading: Promise<THREE.Object3D> | undefined;

function load(): Promise<THREE.Object3D> {
  loading ??= new GLTFLoader().loadAsync(modelUrl).then((gltf) => {
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    return gltf.scene;
  });
  return loading;
}

/**
 * A group in millimetres, the PCB's underside at y = 0, that fills with the board when the model
 * has loaded (then `onReady` is called, to draw it).
 */
export function buildMalkonOneBoard(onReady: () => void, onError: (e: unknown) => void): THREE.Group {
  const group = new THREE.Group();
  group.rotation.y = MALKON_ONE_TURN;
  load().then(
    (scene) => {
      const copy = scene.clone(true);
      copy.scale.setScalar(1000); // metres → millimetres (the file's root also scales by 1/1000)
      group.add(copy);
      onReady();
    },
    (e: unknown) => {
      loading = undefined;
      onError(e);
    },
  );
  return group;
}
