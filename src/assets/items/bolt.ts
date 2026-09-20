import * as THREE from "three";
import type { ItemAssetDef } from "../types";

let wood: THREE.MeshStandardMaterial | undefined;
let metal: THREE.MeshStandardMaterial | undefined;

/** A single recoverable bolt, authored along local +Z with its tip forward. */
export function createBoltMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "bolt";
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(.012, .012, .42, 6),
    wood ??= new THREE.MeshStandardMaterial({ color: 0x6b4b2a, roughness: .9 }),
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = .02;
  group.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(.028, .09, 6),
    metal ??= new THREE.MeshStandardMaterial({ color: 0x707780, metalness: .65, roughness: .4 }),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.z = .275;
  group.add(tip);
  for (const x of [-.035, .035]) {
    const fletching = new THREE.Mesh(new THREE.BoxGeometry(.008, .065, .10), shaft.material);
    fletching.position.set(x, 0, -.18);
    group.add(fletching);
  }
  group.traverse(obj => { if (obj instanceof THREE.Mesh) obj.castShadow = true; });
  return group;
}

const bolt: ItemAssetDef = {
  id: "bolt",
  name: "Crossbow Bolts",
  icon: "➶",
  slot: null,
  mass: .045,
  stackable: true,
  createWorldMesh: createBoltMesh,
};

export default bolt;
