import * as THREE from "three";
import type { ItemAssetDef } from "../types";

// The backpack (inventory expansion, phase 2): a pickupable curio like
// gem.ts/key.ts (`slot: null`, no viewmodel — nothing to equip yet, see the
// module doc below), but also itself a `Container` (see `ContainerSpec` in
// ../types.ts) — the same lootable-storage mechanic a barrel uses
// (`spawnItems` in level/spawning.ts attaches the ECS `Container` component
// identically to how `spawnProps` does for a barrel). Tapping it in the
// inventory list opens its own container panel instead of trying to equip
// it (`InventoryList.tsx`, `CarriedItemView.isContainer`).
//
// `slot: null` for now rather than `"torso"` (the paper-doll already has an
// unused Torso slot) — carrying it (in the inventory list, not equipped)
// already gives its own contents a separate weight budget via
// `containerWeightCapacity` (ecs/systems/items.ts's
// `wouldExceedContainerWeight`), so there's nothing an equip slot would add
// yet; "worn" could become its own separate bonus later.

const BAG_WIDTH = 0.22;
const BAG_HEIGHT = 0.28;
const BAG_DEPTH = 0.14;
const FLAP_HEIGHT = 0.1;
const STRAP_RADIUS = 0.015;

let bagMat: THREE.MeshStandardMaterial | undefined;
function bagMaterial(): THREE.MeshStandardMaterial {
  return (bagMat ??= new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9, metalness: 0 }));
}

let strapMat: THREE.MeshStandardMaterial | undefined;
function strapMaterial(): THREE.MeshStandardMaterial {
  return (strapMat ??= new THREE.MeshStandardMaterial({ color: 0x3f2a1a, roughness: 0.85, metalness: 0 }));
}

function createBackpackMesh(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(BAG_WIDTH, BAG_HEIGHT, BAG_DEPTH), bagMaterial());
  body.position.y = BAG_HEIGHT / 2;
  group.add(body);

  const flap = new THREE.Mesh(new THREE.BoxGeometry(BAG_WIDTH * 1.05, FLAP_HEIGHT, BAG_DEPTH * 1.1), bagMaterial());
  flap.position.set(0, BAG_HEIGHT - FLAP_HEIGHT / 2 + 0.02, 0);
  group.add(flap);

  const strapCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-BAG_WIDTH / 2, BAG_HEIGHT * 0.9, 0),
    new THREE.Vector3(-BAG_WIDTH / 2 - 0.03, BAG_HEIGHT * 0.5, 0),
    new THREE.Vector3(-BAG_WIDTH / 2, BAG_HEIGHT * 0.1, 0),
  ]);
  const strap = new THREE.Mesh(new THREE.TubeGeometry(strapCurve, 12, STRAP_RADIUS, 6, false), strapMaterial());
  group.add(strap);

  return group;
}

const backpack: ItemAssetDef = {
  id: "backpack",
  name: "Backpack",
  icon: "🎒",
  slot: null,
  mass: 0.5,
  container: { capacity: 8 },
  // A separate budget for whatever's zipped inside it -- on top of, not
  // instead of, the player's own unaffected 5kg main cap. Deliberately
  // *below* the main cap (rather than matching it) so the limit is
  // actually reachable with the level's current item set: the sword (3kg)
  // and lantern (1.4kg) together are 4.4kg, just over this 4kg cap, so
  // stashing both at once gets refused -- a real choice between carrying
  // one of them in the backpack (with room left for small stuff too) or
  // holding it directly instead.
  containerWeightCapacity: 4,
  createWorldMesh: () => createBackpackMesh(),
};

export default backpack;
