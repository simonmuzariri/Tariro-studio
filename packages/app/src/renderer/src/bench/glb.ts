/** Loading the workbench's glTF models: each file is fetched and parsed once, then cloned per use. */
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const cache = new Map<string, Promise<THREE.Object3D>>();

/** The model's scene, shared: clone it before adding it anywhere. A failed load is retried next time. */
export function loadGlb(url: string): Promise<THREE.Object3D> {
  let p = cache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      return gltf.scene;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
