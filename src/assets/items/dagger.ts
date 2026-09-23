import * as THREE from "three";
import type { ItemAssetDef } from "../types";
import { createSwordMesh } from "./sword";

/** A compact low-poly dagger derived from the sword's shared blade language.
 * The geometry is baked shorter and narrower so callers can still attach it
 * at unit scale and treat the grip origin / +Z blade axis exactly like sword. */
function createDaggerMesh(): THREE.Mesh {
  // A dagger's guard protects the fingers without the broad quillons of the
  // full sword. Author that distinction before applying the overall dagger
  // scale so it remains visible in world, hand, and icon renders.
  // `bladeLengthScale: 0.7` -- a further 30% off just the blade itself, on
  // top of (and before) the overall `.scale(...)` below -- reads as a
  // shorter, closer-in stabbing blade rather than a shrunken sword.
  const source = createSwordMesh({ crossguardLength: 0.13, triangularBlade: true, bladeLengthScale: 0.7 });
  source.geometry = source.geometry.clone();
  source.geometry.scale(0.72, 0.72, 0.55);
  source.geometry.computeBoundingBox();
  source.geometry.computeBoundingSphere();
  source.name = "dagger";
  return source;
}

const dagger: ItemAssetDef = {
  id: "dagger",
  name: "Dagger",
  icon: "🗡️",
  slot: "hand",
  meleeDamage: 8,
  meleeReach: 1.0,
  mass: 0.6,
  // A light, short blade recovers quicker than a sword's implicit 1x -- the
  // dagger's whole identity is speed traded for reach/damage, not a
  // shrunken sword. Stamina cost is left at the implicit 1x: it's meant to
  // feel faster to swing, not cheaper to spam.
  attackMultipliers: {
    jab: { recovery: 0.8 },
    swing: { recovery: 0.8 },
  },
  createWorldMesh: createDaggerMesh,
  createViewmodelMesh: () => {
    const mesh = createDaggerMesh();
    mesh.scale.setScalar(0.85);
    return mesh;
  },
};

export default dagger;
