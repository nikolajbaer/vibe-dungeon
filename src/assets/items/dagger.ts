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
  const source = createSwordMesh({ crossguardLength: 0.13, triangularBlade: true });
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
  createWorldMesh: createDaggerMesh,
  createViewmodelMesh: () => {
    const mesh = createDaggerMesh();
    mesh.scale.setScalar(0.85);
    return mesh;
  },
};

export default dagger;
