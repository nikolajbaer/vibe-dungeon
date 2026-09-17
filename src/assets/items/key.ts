import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ItemAssetDef } from "../types";

// A curio-only pickup like gem.ts (`slot: null`, no viewmodel) — unlocks a
// `LockedDoorSpec` door (placementTypes.ts) rather than being equipped or
// consumed. A ring (torus) plus a small flattened box for the bit/teeth,
// same "merge a handful of primitives" approach as sword.ts, just far
// simpler geometry.

const RING_RADIUS = 0.09;
const RING_TUBE = 0.018;
const SHAFT_LENGTH = 0.16;
const SHAFT_RADIUS = 0.016;
const BIT_WIDTH = 0.09;
const BIT_HEIGHT = 0.05;
const BIT_DEPTH = 0.02;

let keyMat: THREE.MeshStandardMaterial | undefined;

function keyMaterial(): THREE.MeshStandardMaterial {
  return (keyMat ??= new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.7, roughness: 0.35 }));
}

function createKeyMesh(): THREE.Mesh {
  // Ring at one end, shaft running from the ring toward the bit, bit (the
  // toothed end) at the other. Authored flat in the XY plane (Z is the
  // mesh's thickness) — a key naturally reads front-on, unlike the sword's
  // "tip forward" convention, so no reorientation is needed here.
  const ring = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 8, 16);
  ring.translate(-SHAFT_LENGTH / 2 - RING_RADIUS, 0, 0);

  const shaft = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 8);
  shaft.rotateZ(Math.PI / 2);

  const bit = new THREE.BoxGeometry(BIT_WIDTH, BIT_HEIGHT, BIT_DEPTH);
  bit.translate(SHAFT_LENGTH / 2 + BIT_WIDTH / 2 - 0.02, -BIT_HEIGHT / 4, 0);

  const merged = mergeGeometries([ring, shaft, bit], false);
  if (!merged) throw new Error("key: failed to merge key geometry");
  merged.computeVertexNormals();

  const mesh = new THREE.Mesh(merged, keyMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const key: ItemAssetDef = {
  id: "key",
  name: "Key",
  icon: "🔑",
  slot: null,
  mass: 0.1,
  createWorldMesh: () => createKeyMesh(),
};

export default key;
