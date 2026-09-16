import * as THREE from "three";
import type { ItemAssetDef } from "../types";

// The gem (issue #39): a curio-only item — `slot: null`, no viewmodel, never
// equippable — kept as the template for a future non-equippable pickup
// (e.g. a potion, before any drink-to-consume mechanic exists to make
// `slot: "hand"` meaningful for one). Previously an inline
// `THREE.OctahedronGeometry` built directly in game.ts; migrated here
// unchanged so it's a self-contained asset module like every other item.

let gemMat: THREE.MeshStandardMaterial | undefined;

function gemMaterial(): THREE.MeshStandardMaterial {
  return (gemMat ??= new THREE.MeshStandardMaterial({ color: 0x35d6c4, metalness: 0.1, roughness: 0.2 }));
}

const gem: ItemAssetDef = {
  id: "gem",
  name: "Gem",
  icon: "💎",
  slot: null,
  mass: 0.3, // barely anything — it bounces away from the lightest contact
  createWorldMesh: () => new THREE.Mesh(new THREE.OctahedronGeometry(0.2), gemMaterial()),
};

export default gem;
