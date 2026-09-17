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
// already raises the carry-weight cap via `carryCapacityBonus`
// (ecs/systems/items.ts's `maxCarryWeight`), so there's nothing an equip
// slot would add yet; "worn" could become its own separate bonus later.

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
  // Net +4.5kg of headroom after its own 0.5kg weight -- meaningfully worth
  // carrying without trivializing the base 5kg cap.
  carryCapacityBonus: 5,
  createWorldMesh: () => createBackpackMesh(),
};

export default backpack;
