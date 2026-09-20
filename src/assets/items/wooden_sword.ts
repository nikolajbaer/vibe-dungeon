import * as THREE from "three";
import type { ItemAssetDef } from "../types";
import { createSwordMesh } from "./sword";

function createWoodenSword(): THREE.Mesh {
  const mesh = createSwordMesh({ bluntTip: true });
  mesh.name = "wooden_sword";
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.material = materials.map((material, i) => {
    const wood = material.clone() as THREE.MeshStandardMaterial;
    wood.color.setHex(i === 0 ? 0x9a693e : 0x56351f);
    wood.metalness = 0;
    wood.roughness = .9;
    return wood;
  });
  return mesh;
}

const woodenSword: ItemAssetDef = {
  id: "wooden_sword",
  name: "Wooden Sword",
  icon: "🪵",
  slot: "hand",
  meleeDamage: 5,
  mass: 1.2,
  createWorldMesh: createWoodenSword,
  createViewmodelMesh: () => {
    const mesh = createWoodenSword();
    mesh.scale.setScalar(.85);
    return mesh;
  },
};

export default woodenSword;
