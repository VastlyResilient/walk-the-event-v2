import * as THREE from 'three';

/** ?debug=grid: a 1 m floor grid at the guide's floor height, to verify the solve against the footage. */
export function floorGrid() {
  const g = new THREE.GridHelper(60, 60, 0x00ffff, 0x00ffaa);
  (g.material as THREE.Material).transparent = true;
  (g.material as THREE.Material).opacity = 0.55;
  (g.material as THREE.Material).depthTest = false;
  g.renderOrder = 10;
  return g;
}
