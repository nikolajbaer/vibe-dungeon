import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ItemAssetDef } from "../types";

// The first two-handed *melee* weapon (the crossbow is two-handed but
// ranged-only) -- a plain hardwood pole with metal-capped ends and a
// wrapped leather grip band at the center. Unlike sword.ts's "grip at one
// end" convention, a quarterstaff has no natural single grip end -- it's
// held and swung around its own middle with both hands -- so this is
// authored centered on the origin instead. Still rotated 90° about X at
// the end into the shared "long axis Z" convention every viewmodel mesh in
// this repo uses, even though nothing here actually calls `lookAt` on it
// (it uses a fixed, centered `viewmodelTransform` below, the same pattern
// crossbow.ts uses for its own two-handed hold) -- keeping the convention
// costs nothing and matches every other weapon mesh in this file's
// authoring assumptions if a future caller ever does need to `lookAt` it.

const STAFF_LENGTH = 1.7;
const STAFF_RADIUS = 0.02;
const CAP_LENGTH = 0.09;
const CAP_RADIUS = 0.028;
const GRIP_LENGTH = 0.26;
const GRIP_RADIUS = 0.026;

// Same "shrink a touch for the closer camera" scale-down every viewmodel in
// this repo uses.
const VIEWMODEL_SCALE = 0.85;

let woodMat: THREE.MeshStandardMaterial | undefined;
let metalMat: THREE.MeshStandardMaterial | undefined;
let gripMat: THREE.MeshStandardMaterial | undefined;

function woodMaterial(): THREE.MeshStandardMaterial {
  return (woodMat ??= new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.85 }));
}
function metalMaterial(): THREE.MeshStandardMaterial {
  return (metalMat ??= new THREE.MeshStandardMaterial({ color: 0x8b8f96, metalness: 0.6, roughness: 0.4 }));
}
function gripMaterial(): THREE.MeshStandardMaterial {
  return (gripMat ??= new THREE.MeshStandardMaterial({ color: 0x2e2119, roughness: 0.95 }));
}

/**
 * Builds one merged low-poly quarterstaff mesh: a plain shaft, two metal
 * end caps, and a wrapped grip band at the center, as three material groups
 * (wood, then metal, then grip) on a single `THREE.BufferGeometry` --
 * `mergeGeometries(..., true)` adds a geometry group per input so a
 * `[wood, metal, grip]` materials array renders correctly, the same pattern
 * `sword.ts`'s `createSwordMesh` uses for its own two-material merge.
 */
export function createQuarterstaffMesh(): THREE.Mesh {
  const shaft = new THREE.CylinderGeometry(STAFF_RADIUS, STAFF_RADIUS, STAFF_LENGTH, 8);
  const woodGeo = mergeGeometries([shaft], false);
  if (!woodGeo) throw new Error("quarterstaff: failed to merge wood geometry");

  const capTop = new THREE.CylinderGeometry(CAP_RADIUS, CAP_RADIUS, CAP_LENGTH, 8);
  capTop.translate(0, STAFF_LENGTH / 2 - CAP_LENGTH / 2, 0);
  const capBottom = new THREE.CylinderGeometry(CAP_RADIUS, CAP_RADIUS, CAP_LENGTH, 8);
  capBottom.translate(0, -STAFF_LENGTH / 2 + CAP_LENGTH / 2, 0);
  const metalGeo = mergeGeometries([capTop, capBottom], false);
  if (!metalGeo) throw new Error("quarterstaff: failed to merge metal geometry");

  const grip = new THREE.CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, GRIP_LENGTH, 8);

  const merged = mergeGeometries([woodGeo, metalGeo, grip], true);
  if (!merged) throw new Error("quarterstaff: failed to merge quarterstaff geometry");
  merged.rotateX(Math.PI / 2);
  merged.computeVertexNormals();

  const mesh = new THREE.Mesh(merged, [woodMaterial(), metalMaterial(), gripMaterial()]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const quarterstaff: ItemAssetDef = {
  id: "quarterstaff",
  name: "Quarterstaff",
  icon: "🦯",
  slot: "hand",
  twoHanded: true,
  // Less damage and a slower, more stamina-hungry swing than the sword
  // (15/1/1), traded for meaningfully longer reach -- a reach weapon that
  // whiff-punishes rather than trades blows toe-to-toe.
  meleeDamage: 12,
  meleeReach: 2.0,
  attackRecoveryMultiplier: 1.4,
  attackStaminaMultiplier: 1.35,
  mass: 2.5,
  createWorldMesh: createQuarterstaffMesh,
  createViewmodelMesh: () => {
    const mesh = createQuarterstaffMesh();
    mesh.scale.setScalar(VIEWMODEL_SCALE);
    return mesh;
  },
  // Held centered rather than per-hand-offset, the same fixed-transform
  // pattern crossbow.ts uses for its own two-handed grip -- see
  // `viewmodelSwingSystem`'s `custom` lookup (ecs/systems/items.ts) for how
  // jab/swing/block animate around this instead of the generic
  // `VIEWMODEL_OFFSET`.
  viewmodelTransform: { position: [0, -0.32, -0.62], rotation: [0.35, 0, 0] },
};

export default quarterstaff;
