import * as THREE from "three";
import type { ItemAssetDef } from "../types";
import { createSwordMesh } from "./sword";

/** A two-handed greatsword derived from the one-handed sword's shared blade
 * language -- scaled up (particularly in length, more than width) and given
 * a longer crossguard, the same "reuse the shared geometry, scale/reshape
 * it" pattern `dagger.ts` uses to go the other direction. */
function createGreatswordMesh(): THREE.Mesh {
  const source = createSwordMesh({ crossguardLength: 0.32 });
  source.geometry = source.geometry.clone();
  source.geometry.scale(1.15, 1.15, 1.5);
  source.geometry.computeBoundingBox();
  source.geometry.computeBoundingSphere();
  source.name = "greatsword";
  return source;
}

const greatsword: ItemAssetDef = {
  id: "greatsword",
  name: "Greatsword",
  icon: "⚔️",
  slot: "hand",
  twoHanded: true,
  // Same flat meleeDamage/meleeReach baseline as the one-handed sword --
  // every bit of this weapon's actual identity lives in attackMultipliers
  // below, since its two attacks are meant to feel different from each
  // other, not just a uniform scale of the sword's like the quarterstaff.
  meleeDamage: 15,
  meleeReach: 1.4,
  attackMultipliers: {
    // The stab: barely more damage/reach than a one-handed sword's (both
    // left at their implicit 1x -- literally identical to the sword's own
    // jab), but a real two-handed weapon is slower and more tiring to
    // commit to a stab with at all.
    jab: { recovery: 1.25, stamina: 1.25 },
    // The swing is this weapon's whole reason to exist: 1.5x damage and
    // 1.25x reach over a one-handed sword's swing, at the cost of an even
    // slower recovery and higher stamina spend than the stab's already-
    // higher ones -- a huge, committed two-handed cut, not something to
    // throw out repeatedly.
    swing: { damage: 1.5, reach: 1.25, recovery: 1.5, stamina: 1.6 },
  },
  mass: 4.5,
  createWorldMesh: createGreatswordMesh,
  createViewmodelMesh: () => {
    const mesh = createGreatswordMesh();
    mesh.scale.setScalar(0.85);
    return mesh;
  },
  // Held centered with both hands, the same fixed-transform pattern
  // quarterstaff.ts/crossbow.ts use -- see viewmodelSwingSystem's `custom`
  // lookup (ecs/systems/items.ts) for how jab/swing/block animate around
  // this instead of the generic per-hand VIEWMODEL_OFFSET.
  // Derived the same way sword.ts's own per-hand VIEWMODEL_OFFSET was: pose
  // the mesh with `Object3D.lookAt` aiming the blade up and into the scene
  // ahead of the camera, then read back the resulting Euler angles -- see
  // that file's header comment for the full method. Centered (x: 0) rather
  // than per-hand-offset, the same fixed-transform pattern crossbow.ts/
  // quarterstaff.ts use for their own two-handed grip.
  viewmodelTransform: { position: [0, -0.3, -0.4], rotation: [-2.0608, 0, -Math.PI] },
};

export default greatsword;
