import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ItemAssetDef } from "../types";

// A one-handed thrown spear -- long and thin like the quarterstaff, but
// gripped off-center near the rear third (like sword.ts's "grip near one
// end, tip at +Z" convention) rather than centered, since it's swung/jabbed
// and thrown one-handed, not held with both hands at its middle. Authored
// standing with the grip at the origin and the head at +Y, then rotated 90°
// about X into the shared "long axis Z, tip at +Z" convention every
// viewmodel mesh in this repo uses, so `Object3D.lookAt` (and the derived
// `throwChamberRot`/jab poses in ecs/systems/items.ts) work the same way
// they do for the sword/dagger.

// Sized at roughly 3/4 the quarterstaff's own length (1.7m -- see
// quarterstaff.ts's STAFF_LENGTH) rather than the sword's compact scale --
// a real thrown spear reads as a substantial two-handed-ish weapon even
// though it's mechanically one-handed for equip/dual-wield purposes, and a
// too-small mesh (an earlier pass at 0.9m total) looked more like a long
// dagger than a javelin. Most of the extra length went into the forward
// (blade-ward) section rather than the tail: the tail end swings closest to
// the camera in the resting/jab pose (see `VIEWMODEL_OFFSET` in
// ecs/systems/items.ts), so growing it as much as the front would exaggerate
// near-camera perspective blow-up more than growing the receding front does.
const SHAFT_FORWARD_LENGTH = 0.9; // grip to the base of the head
const HEAD_LENGTH = 0.2;
const SHAFT_RADIUS = 0.02;
const HEAD_BASE_RADIUS = 0.04;
const HEAD_TIP_RADIUS = 0.006;
const TAIL_LENGTH = 0.18; // grip to the fletched butt end
const TAIL_CAP_LENGTH = 0.05;
const TAIL_CAP_RADIUS = 0.028;
const GRIP_LENGTH = 0.2;
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
  return (metalMat ??= new THREE.MeshStandardMaterial({ color: 0xaab0b8, metalness: 0.55, roughness: 0.35 }));
}
function gripMaterial(): THREE.MeshStandardMaterial {
  return (gripMat ??= new THREE.MeshStandardMaterial({ color: 0x2e2119, roughness: 0.95 }));
}

/**
 * Builds one merged low-poly javelin mesh: a plain wood shaft running both
 * forward (to a tapered metal head) and back (to a small metal butt cap)
 * from a central grip band, as three material groups (wood, metal, grip) on
 * a single `THREE.BufferGeometry` -- the same merge/material-group pattern
 * `sword.ts`/`quarterstaff.ts` use.
 */
export function createJavelinMesh(): THREE.Mesh {
  const shaftForward = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_FORWARD_LENGTH, 6);
  shaftForward.translate(0, SHAFT_FORWARD_LENGTH / 2, 0);
  const shaftBack = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, TAIL_LENGTH - TAIL_CAP_LENGTH, 6);
  shaftBack.translate(0, -(TAIL_LENGTH - TAIL_CAP_LENGTH) / 2, 0);
  const woodGeo = mergeGeometries([shaftForward, shaftBack], false);
  if (!woodGeo) throw new Error("javelin: failed to merge wood geometry");

  const head = new THREE.CylinderGeometry(HEAD_TIP_RADIUS, HEAD_BASE_RADIUS, HEAD_LENGTH, 6);
  head.translate(0, SHAFT_FORWARD_LENGTH + HEAD_LENGTH / 2, 0);
  const tailCap = new THREE.CylinderGeometry(TAIL_CAP_RADIUS, TAIL_CAP_RADIUS * 0.6, TAIL_CAP_LENGTH, 6);
  tailCap.translate(0, -TAIL_LENGTH + TAIL_CAP_LENGTH / 2, 0);
  const metalGeo = mergeGeometries([head, tailCap], false);
  if (!metalGeo) throw new Error("javelin: failed to merge metal geometry");

  const grip = new THREE.CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, GRIP_LENGTH, 6);

  const merged = mergeGeometries([woodGeo, metalGeo, grip], true);
  if (!merged) throw new Error("javelin: failed to merge javelin geometry");
  merged.rotateX(Math.PI / 2);
  merged.computeVertexNormals();

  const mesh = new THREE.Mesh(merged, [woodMaterial(), metalMaterial(), gripMaterial()]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const javelin: ItemAssetDef = {
  id: "javelin",
  name: "Javelin",
  icon: "🥢",
  slot: "hand",
  // A spear-length jab: less raw power than a sword's, traded for
  // meaningfully longer reach -- same "reach weapon" role the quarterstaff
  // plays, just one-handed and light enough to dual-wield alongside a
  // dagger (see items.ts's DUAL_WIELD_MAX_COMBINED_WEIGHT).
  meleeDamage: 11,
  meleeReach: 1.7,
  mass: 1.6,
  // Thrown through the shared jab-or-charge-and-release input (see this
  // field's own doc comment in assets/types.ts) rather than a dedicated
  // aim-and-fire button -- a hand-simulated flight, same shape as a fired
  // crossbow bolt (a raycast swept along a manually-integrated gravity arc --
  // see `ecs/systems/throwingCombat.ts`), just noticeably slower
  // (crossbow.ts's own bolt: `projectileSpeed: 34`), reading as a heavier,
  // lobbed throw rather than a flat, fast shot. Damage is high enough to
  // drop a fully-guarded "guard" NPC (45 HP, ecs/systems/combat.ts's
  // BLOCK_MITIGATION.oneHanded) in one hit at close range, since a thrown
  // hit -- like a bolt -- bypasses melee blocking entirely
  // (`applyRangedDamage`). `maxRange` is a hard flight-distance cutoff, same
  // meaning as a bolt's own: past this many meters (regardless of how long
  // that takes at this weapon's own `projectileSpeed`) it lands wherever it
  // is instead of continuing to fly.
  throwable: { damage: 55, projectileSpeed: 12, maxRange: 18 },
  createWorldMesh: createJavelinMesh,
  createViewmodelMesh: () => {
    const mesh = createJavelinMesh();
    mesh.scale.setScalar(VIEWMODEL_SCALE);
    return mesh;
  },
};

export default javelin;
