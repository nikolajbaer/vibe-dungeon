import * as THREE from "three";
import type { ItemAssetDef } from "../types";

let wood: THREE.MeshStandardMaterial | undefined;
let metal: THREE.MeshStandardMaterial | undefined;

function createCrossbowMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "crossbow";
  group.userData.surfaceMaterial = "wood";
  const woodMat = wood ??= new THREE.MeshStandardMaterial({ color: 0x704522, roughness: .84 });
  const metalMat = metal ??= new THREE.MeshStandardMaterial({ color: 0x555c64, metalness: .7, roughness: .42 });
  const stock = new THREE.Mesh(new THREE.BoxGeometry(.11, .12, .72), woodMat);
  stock.position.z = .08;
  group.add(stock);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(.055, .035, .72), metalMat);
  rail.position.set(0, .075, -.03);
  group.add(rail);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(.86, .055, .06), woodMat);
  bow.position.set(0, .04, -.30);
  group.add(bow);
  const stirrup = new THREE.Mesh(new THREE.TorusGeometry(.10, .018, 5, 10, Math.PI), metalMat);
  stirrup.rotation.x = Math.PI / 2;
  stirrup.rotation.z = Math.PI;
  stirrup.position.set(0, 0, -.43);
  group.add(stirrup);
  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-.43, .04, -.30), new THREE.Vector3(0, .10, .03), new THREE.Vector3(.43, .04, -.30),
  ]);
  group.add(new THREE.Line(stringGeometry, new THREE.LineBasicMaterial({ color: 0xc9c1a5 })));
  group.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true; } });
  return group;
}

const crossbow: ItemAssetDef = {
  id: "crossbow",
  name: "Crossbow",
  icon: "🏹",
  slot: "hand",
  mass: 3.4,
  rangedWeapon: { ammoItemTypeId: "bolt", damage: 18, reloadSeconds: 1.5, projectileSpeed: 18, maxRange: 12 },
  createWorldMesh: createCrossbowMesh,
  createViewmodelMesh: () => {
    const mesh = createCrossbowMesh();
    mesh.scale.setScalar(.78);
    return mesh;
  },
  viewmodelTransform: { position: [0, -.30, -.62], rotation: [0, 0, 0] },
};

export default crossbow;
