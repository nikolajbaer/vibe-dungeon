import * as THREE from "three";
import type { ItemAssetDef } from "../types";
import sword from "./sword";

/** A compact low-poly dagger derived from the sword's shared blade language.
 * The geometry is baked shorter and narrower so callers can still attach it
 * at unit scale and treat the grip origin / +Z blade axis exactly like sword. */
function createDaggerMesh(): THREE.Mesh {
  const source = sword.createWorldMesh() as THREE.Mesh;
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
  mass: 0.6,
  createWorldMesh: createDaggerMesh,
  createViewmodelMesh: () => {
    const mesh = createDaggerMesh();
    mesh.scale.setScalar(0.85);
    return mesh;
  },
};

export default dagger;
