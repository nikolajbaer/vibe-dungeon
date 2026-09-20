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

let buckleMat: THREE.MeshStandardMaterial | undefined;
function buckleMaterial(): THREE.MeshStandardMaterial {
  return (buckleMat ??= new THREE.MeshStandardMaterial({ color: 0xb69245, roughness: .42, metalness: .65 }));
}

function createBackpackMesh(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(BAG_WIDTH, BAG_HEIGHT, BAG_DEPTH), bagMaterial());
  body.position.y = BAG_HEIGHT / 2;
  group.add(body);

  const flap = new THREE.Mesh(new THREE.BoxGeometry(BAG_WIDTH * 1.05, FLAP_HEIGHT, BAG_DEPTH * 1.1), bagMaterial());
  flap.position.set(0, BAG_HEIGHT - FLAP_HEIGHT / 2 + 0.02, 0);
  group.add(flap);

  // Two thick bowed shoulder straps. Their curves sit just proud of the
  // bag so the elliptical silhouettes remain visible from a 3/4 view.
  for (const side of [-1, 1]) {
    const x = side * BAG_WIDTH * .28;
    const strapCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, BAG_HEIGHT * .88, BAG_DEPTH / 2 + .012),
      new THREE.Vector3(x + side * .035, BAG_HEIGHT * .52, BAG_DEPTH / 2 + .04),
      new THREE.Vector3(x, BAG_HEIGHT * .14, BAG_DEPTH / 2 + .012),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(strapCurve, 14, STRAP_RADIUS, 6, false), strapMaterial()));
  }

  const closure = new THREE.Mesh(new THREE.BoxGeometry(.035, .115, .014), strapMaterial());
  closure.position.set(0, BAG_HEIGHT * .69, BAG_DEPTH / 2 + .065);
  group.add(closure);

  // Four simple bars make a readable square buckle without filling its
  // center, even when the icon is rendered down to the phone UI.
  const buckleY = BAG_HEIGHT * .57;
  const buckleZ = BAG_DEPTH / 2 + .076;
  for (const x of [-.025, .025]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(.007, .042, .009), buckleMaterial());
    bar.position.set(x, buckleY, buckleZ);
    group.add(bar);
  }
  for (const y of [-.018, .018]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(.057, .007, .009), buckleMaterial());
    bar.position.set(0, buckleY + y, buckleZ);
    group.add(bar);
  }

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
