import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ItemAssetDef } from "../types";

// A second, distinct key type (training wing task) — unlocks the training
// wing's lockpicking-nook door (`rooms/training-wing.ts`'s `lockedDoors`
// entry), kept as its own `ItemAssetDef` rather than reusing `key.ts`'s
// `"key"` id: `LockedDoorSpec.requiredItemTypeId` only checks "does the
// player carry an item of this type", so two doors sharing one key id would
// mean either key opens both, which would muddle the two unrelated
// call-backs (side-chamber's key/room-b's door; this one/the training
// wing's own nook) rather than keeping each self-contained. Same geometry
// approach as `key.ts` (a ring + shaft + bit merged into one mesh), tinted a
// duller, tarnished color so it reads as visually distinct at a glance.

const RING_RADIUS = 0.08;
const RING_TUBE = 0.016;
const SHAFT_LENGTH = 0.14;
const SHAFT_RADIUS = 0.014;
const BIT_WIDTH = 0.08;
const BIT_HEIGHT = 0.045;
const BIT_DEPTH = 0.018;

let rustyKeyMat: THREE.MeshStandardMaterial | undefined;
function rustyKeyMaterial(): THREE.MeshStandardMaterial {
  return (rustyKeyMat ??= new THREE.MeshStandardMaterial({ color: 0x6b5a3a, metalness: 0.55, roughness: 0.7 }));
}

function createRustyKeyMesh(): THREE.Mesh {
  const ring = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 8, 16);
  ring.translate(-SHAFT_LENGTH / 2 - RING_RADIUS, 0, 0);

  const shaft = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 8);
  shaft.rotateZ(Math.PI / 2);

  const bit = new THREE.BoxGeometry(BIT_WIDTH, BIT_HEIGHT, BIT_DEPTH);
  bit.translate(SHAFT_LENGTH / 2 + BIT_WIDTH / 2 - 0.02, -BIT_HEIGHT / 4, 0);

  const merged = mergeGeometries([ring, shaft, bit], false);
  if (!merged) throw new Error("rusty_key: failed to merge key geometry");
  merged.computeVertexNormals();

  const mesh = new THREE.Mesh(merged, rustyKeyMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const rustyKey: ItemAssetDef = {
  id: "rusty_key",
  name: "Rusty Key",
  icon: "🗝️",
  slot: null,
  mass: 0.1,
  createWorldMesh: () => createRustyKeyMesh(),
};

export default rustyKey;
