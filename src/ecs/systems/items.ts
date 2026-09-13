import * as THREE from "three";
import { addComponent, hasComponent, query, type World } from "bitecs";
import { Carried, Item, Object3DRef, Viewmodel, type CarriedSlot } from "../components";
import { ITEM_TYPES } from "../../items/itemTypes";

export type HandSlot = "hand-left" | "hand-right";

function isHandSlot(slot: CarriedSlot): slot is HandSlot {
  return slot === "hand-left" || slot === "hand-right";
}

/**
 * Picks up a world item: called from the `Item` branch of `tryInteract`
 * (doors.ts) when the interact raycast hits an `Item` entity that has no
 * `Carried` component yet. Adds `Carried` (slot `"inventory"`, owned by
 * `ownerEid`) and hides the item's in-world pickup mesh — hidden rather than
 * removed from the scene/ECS so a future "drop" could just flip it back to
 * visible, and so it stops showing up in `tryInteract`'s own interactable
 * list (that list explicitly skips any `Item` that already has `Carried`).
 */
export function pickUpItem(world: World, itemEid: number, ownerEid: number): void {
  addComponent(world, itemEid, Carried);
  Carried.ownerEid[itemEid] = ownerEid;
  Carried.slot[itemEid] = "inventory";

  const obj = Object3DRef[itemEid];
  if (obj) obj.visible = false;
}

/** Camera-relative offsets for each hand's viewmodel — lower corners of the
 * view, angled slightly inward, so a mesh in either hand reads as "held" up
 * close to the camera without covering the center of the screen. */
const VIEWMODEL_OFFSET: Record<HandSlot, { pos: THREE.Vector3Tuple; rot: THREE.EulerTuple }> = {
  "hand-right": { pos: [0.35, -0.35, -0.75], rot: [-0.5, 0, 0.65] },
  "hand-left": { pos: [-0.35, -0.35, -0.75], rot: [-0.5, 0, -0.65] },
};

/** Builds a first-person viewmodel mesh for an item type, or `undefined` if
 * that type has no viewmodel look defined yet (only equippable — `slot:
 * "hand"` — item types need one). Placeholder-grade geometry only, matching
 * the world-item meshes in game.ts (no texture assets). */
function createViewmodelMesh(itemTypeId: string): THREE.Object3D | undefined {
  if (itemTypeId === "sword") {
    return new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.85),
      new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.3, roughness: 0.4 }),
    );
  }
  return undefined;
}

/**
 * Finds an open hand slot (`hand-left` before `hand-right`) among
 * everything `ownerEid` currently carries, or `undefined` if both are
 * occupied.
 */
export function findOpenHandSlot(world: World, ownerEid: number): HandSlot | undefined {
  let leftOpen = true;
  let rightOpen = true;
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== ownerEid) continue;
    const slot = Carried.slot[eid];
    if (slot === "hand-left") leftOpen = false;
    else if (slot === "hand-right") rightOpen = false;
  }
  return leftOpen ? "hand-left" : rightOpen ? "hand-right" : undefined;
}

/**
 * Equips a carried, equippable item into a specific hand slot: moves
 * `Carried.slot` there and, if the item type has a viewmodel look, attaches
 * it directly to the camera (`camera.add`, not the scene) at a fixed
 * camera-relative offset (see `VIEWMODEL_OFFSET`) — see `Viewmodel` in
 * components.ts for why this is a separate mesh from the item's in-world
 * `Object3DRef`. No-ops if the item isn't carried or isn't a `slot: "hand"`
 * item type. Does not check whether `slot` is actually open — callers
 * (`equipToOpenHandSlot` below) are expected to have picked an open one.
 */
export function equipItem(world: World, camera: THREE.Camera, itemEid: number, slot: HandSlot): void {
  if (!hasComponent(world, itemEid, Carried)) return;
  const itemType = ITEM_TYPES[Item.itemTypeId[itemEid]];
  if (!itemType || itemType.slot !== "hand") return;

  Carried.slot[itemEid] = slot;

  const mesh = createViewmodelMesh(itemType.id);
  if (mesh) {
    const { pos, rot } = VIEWMODEL_OFFSET[slot];
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    camera.add(mesh);
    Viewmodel[itemEid] = mesh;
  }
}

/**
 * Equips `itemEid` into whichever hand slot is open for its owner, or does
 * nothing if both hands are already full (or the item can't be equipped at
 * all). This is what the inventory UI's "tap an inventory item to equip it"
 * action actually calls (see `src/inventory/store.ts`) — the UI never picks
 * a slot itself. Returns whether it actually equipped anything.
 */
export function equipToOpenHandSlot(world: World, camera: THREE.Camera, itemEid: number): boolean {
  if (!hasComponent(world, itemEid, Carried)) return false;
  const ownerEid = Carried.ownerEid[itemEid];
  const slot = findOpenHandSlot(world, ownerEid);
  if (!slot) return false;
  equipItem(world, camera, itemEid, slot);
  return true;
}

/**
 * Unequips a carried item back to the inventory list, removing its
 * viewmodel mesh (if it had one) from the camera. No-ops for an item that
 * isn't carried or isn't currently in a hand slot.
 */
export function unequipItem(world: World, itemEid: number): void {
  if (!hasComponent(world, itemEid, Carried)) return;
  if (!isHandSlot(Carried.slot[itemEid])) return;

  Carried.slot[itemEid] = "inventory";

  const mesh = Viewmodel[itemEid];
  if (mesh) {
    mesh.removeFromParent();
    Viewmodel[itemEid] = undefined;
  }
}
