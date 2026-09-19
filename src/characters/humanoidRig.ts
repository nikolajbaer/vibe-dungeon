import * as THREE from 'three';
import { createHumanoidBase, type HumanoidOptions } from './humanoidBase';

export type HumanoidRig = ReturnType<typeof createHumanoidBase>;
export { type HumanoidOptions, type HumanoidSpecies } from './humanoidBase';

/** Clone with SkeletonUtils.clone for independently animated instances. */
export function createHumanoidRig(options: HumanoidOptions = {}): HumanoidRig {
  return createHumanoidBase(options);
}
let sharedRig: HumanoidRig | undefined;
let banditRig: HumanoidRig | undefined;
let weaponsMasterRig: HumanoidRig | undefined;
let quartermasterRig: HumanoidRig | undefined;
let guardRig: HumanoidRig | undefined;
export function getSharedHumanoidRig(): HumanoidRig {
  return sharedRig ??= createHumanoidRig({ hair: 'long', hairColor: 0x6b4226, tunic: 0x4f6f55 });
}
export function getBanditHumanoidRig(): HumanoidRig {
  return banditRig ??= createHumanoidRig({ weapon: 'dagger', hair: 'short', hairColor: 0x171514, tunic: 0x7b3f35 });
}
export function getWeaponsMasterHumanoidRig(): HumanoidRig {
  return weaponsMasterRig ??= createHumanoidRig({ weapon: 'woodenSword', hair: 'short', hairColor: 0xd1aa63, tunic: 0x3f5872, chainmail: true });
}
export function getQuartermasterHumanoidRig(): HumanoidRig {
  return quartermasterRig ??= createHumanoidRig({ hair: 'short', hairColor: 0xc9a35c, tunic: 0x8a6a32, trousers: 0x403a32 });
}
export function getGuardHumanoidRig(): HumanoidRig {
  return guardRig ??= createHumanoidRig({ weapon: 'shortSword', hair: 'none', tunic: 0x4b5563, trousers: 0x292d33, chainmail: true, nasalHelmet: true });
}
export function tintClonedMesh(mesh: THREE.Object3D, color: number): void {
  mesh.traverse(child => {
    // Costume tint belongs to the skinned body, not held metal/leather props.
    if (!(child instanceof THREE.SkinnedMesh)) return;
    const tint = (material: THREE.Material) => {
      const cloned = material.clone() as THREE.MeshStandardMaterial;
      cloned.color.multiply(new THREE.Color(color));
      return cloned;
    };
    child.material = Array.isArray(child.material) ? child.material.map(tint) : tint(child.material);
  });
}
