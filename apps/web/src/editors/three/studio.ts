import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Broad reflections make plated pads readable from both sides without whitening the mask. */
export function studioLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene, shadows?: { center: THREE.Vector3; radius: number }): () => void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .45;
  room.dispose(); pmrem.dispose();
  const ambient = new THREE.HemisphereLight(0xffffff, 0xc4cbd5, .45); ambient.position.set(0, 0, 100); scene.add(ambient);
  const lights: THREE.DirectionalLight[] = [];
  for (const [x, y, z, intensity] of [[40, -60, 90, 1.2], [-50, 40, 60, .35], [-30, -40, -80, 1.2]]) {
    const light = new THREE.DirectionalLight(0xffffff, intensity); light.position.set(x, y, z); scene.add(light);
    if (shadows) {
      const { center, radius } = shadows;
      light.position.copy(center).addScaledVector(new THREE.Vector3(x, y, z).normalize(), radius * 4);
      light.target.position.copy(center); scene.add(light.target);
      light.castShadow = z > 0 && y < 0 || z < 0;
      light.shadow.mapSize.set(2048, 2048); light.shadow.normalBias = .025;
      Object.assign(light.shadow.camera, { left: -radius * 2, right: radius * 2, top: radius * 2, bottom: -radius * 2, near: .1, far: radius * 8 });
    }
    lights.push(light);
  }
  return () => { scene.environment = null; environment.dispose(); scene.remove(ambient); for (const light of lights) { light.dispose(); scene.remove(light, light.target); } };
}
