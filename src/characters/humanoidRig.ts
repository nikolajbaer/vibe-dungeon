import * as THREE from 'three';
import { createHumanoidBase, type HumanoidOptions } from './humanoidBase';

export type HumanoidRig = ReturnType<typeof createHumanoidBase>;
export { type HumanoidOptions, type HumanoidSpecies } from './humanoidBase';

/** Clone with SkeletonUtils.clone for independently animated instances. */
export function createHumanoidRig(options: HumanoidOptions = {}): HumanoidRig {
  return createHumanoidBase(options);
}
let sharedRig: HumanoidRig | undefined;
export function getSharedHumanoidRig(): HumanoidRig {
  return sharedRig ??= createHumanoidRig();
}
export function tintClonedMesh(mesh: THREE.Object3D, color: number): void {
  mesh.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const tint = (material: THREE.Material) => {
      const cloned = material.clone() as THREE.MeshStandardMaterial;
      cloned.color.multiply(new THREE.Color(color));
      return cloned;
    };
    child.material = Array.isArray(child.material) ? child.material.map(tint) : tint(child.material);
  });
}
