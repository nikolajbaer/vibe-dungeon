import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";
import { woodMaterial } from "./table";

// Wooden storage chest (dormitory furnishing) — a lootable `Container`,
// exactly the same mechanic as barrel.ts (see that file's own comment on
// `FurnitureAssetDef.container`), just a chest-shaped mesh instead of a
// barrel one so a bedroom reads as a bedroom rather than a storeroom. Built
// from a box body, a slightly overhanging lid, and two small metal bands for
// a "iron-bound chest" read, same low-poly-primitives approach as every
// other furniture asset here.
//
// Declares `dynamic` (like barrel.ts), not just a static `footprint` --
// `spawnProps` (level/spawning.ts) only wires up the `Container`
// component/interact-hitbox on the *dynamic* branch today (see
// `FurnitureAssetDef.container`'s own doc comment: "currently only
// supported alongside `dynamic`... a purely static container would need
// that generalized when one shows up"). A static chest would render and
// collide fine but never actually be lootable, so this follows the barrel's
// path rather than bed.ts's/candelabra's static one.

const CHEST_WIDTH = 0.9;
const CHEST_DEPTH = 0.5;
const CHEST_BODY_HEIGHT = 0.42;
const CHEST_LID_HEIGHT = 0.14;
const CHEST_BAND_WIDTH = 0.06;

let chestMetalMat: THREE.MeshStandardMaterial | undefined;
function chestMetalMaterial(): THREE.MeshStandardMaterial {
  return (chestMetalMat ??= new THREE.MeshStandardMaterial({ color: 0x3a3a3f, roughness: 0.6, metalness: 0.6 }));
}

/** A wood box body, a slightly wider lid on top, and two iron corner bands
 * running over the lid seam for a "iron-bound chest" silhouette. */
function createChestMesh(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial();

  const body = new THREE.Mesh(new THREE.BoxGeometry(CHEST_WIDTH, CHEST_BODY_HEIGHT, CHEST_DEPTH), wood);
  body.position.y = CHEST_BODY_HEIGHT / 2;
  group.add(body);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(CHEST_WIDTH + 0.03, CHEST_LID_HEIGHT, CHEST_DEPTH + 0.03), wood);
  lid.position.y = CHEST_BODY_HEIGHT + CHEST_LID_HEIGHT / 2;
  group.add(lid);

  const bandGeo = new THREE.BoxGeometry(CHEST_BAND_WIDTH, CHEST_BODY_HEIGHT + CHEST_LID_HEIGHT + 0.01, CHEST_DEPTH + 0.035);
  for (const sign of [-1, 1] as const) {
    const band = new THREE.Mesh(bandGeo, chestMetalMaterial());
    band.position.set(sign * (CHEST_WIDTH / 2 - CHEST_BAND_WIDTH / 2 - 0.05), (CHEST_BODY_HEIGHT + CHEST_LID_HEIGHT) / 2, 0);
    group.add(band);
  }

  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), chestMetalMaterial());
  latch.position.set(0, CHEST_BODY_HEIGHT, CHEST_DEPTH / 2 + 0.02);
  group.add(latch);

  return group;
}

const CHEST_CAPACITY = 6;

const chest: FurnitureAssetDef = {
  id: "chest",
  createMesh: () => createChestMesh(),
  footprint: { hx: CHEST_WIDTH / 2, hz: CHEST_DEPTH / 2 },
  // A full wooden chest -- heavier than the barrel (28kg), it takes a real
  // shove to budge, but it's not bolted down either. See the header comment
  // for why `dynamic` (not just `footprint`) is required for a container.
  dynamic: { mass: 35 },
  container: { capacity: CHEST_CAPACITY },
};

export default chest;
