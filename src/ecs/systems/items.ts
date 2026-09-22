import * as THREE from "three";
import { addComponent, addEntity, hasComponent, query, removeComponent, type World } from "bitecs";
import { Carried, CarryCapacity, Container, Embedded, Item, Object3DRef, PhysicsBody, Stackable, Viewmodel, type CarriedSlot } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";

export type HandSlot = "hand-left" | "hand-right";

/** Exported for combat.ts (checking whether an item is equipped in *a* hand,
 * not which one) as well as internal use here. */
export function isHandSlot(slot: CarriedSlot): slot is HandSlot {
  return slot === "hand-left" || slot === "hand-right";
}

/** Base max carry weight (kg), before any carried container's bonus (see
 * `maxCarryWeight` below) — reusing `ItemAssetDef.mass` (previously only a
 * physics-feel knob for a world item's falling/skittering body, see
 * `boxShapeOf`/`addDynamicBox` in level/spawning.ts) as each item's carry
 * weight too, rather than adding a second, separate "weight" field every
 * asset would need to declare. Tuned against the level's current item set
 * (sword 3 + lantern 1.4 + everything else adds up past 5) so grabbing a
 * couple of the heavier pieces is fine, but trying to carry literally
 * everything at once isn't — without a backpack, anyway. */
export const BASE_CARRY_WEIGHT = 5;

/** Max number of distinct entries the player's main inventory list
 * (`Carried.slot === "inventory"`) can hold — equipped items (either hand
 * slot) and whatever's zipped inside a carried backpack don't count against
 * this, so it's specifically "how many separate things can you be holding
 * loose at once," not a total-item cap. A `Stackable` entity (a coin pile)
 * is one slot no matter its count — see `wouldExceedInventorySlots` below —
 * since stacking exists specifically to avoid spending a slot per pickup.
 * Carrying a backpack is the way to hold more than this at once: its own
 * contents get their own separate item-count capacity
 * (`ItemAssetDef.container.capacity`). */
export const MAX_INVENTORY_SLOTS = 6;

/** Weight (kg) for an item type that doesn't declare `mass` — intentionally
 * a separate constant from `DEFAULT_ITEM_MASS` in level/spawning.ts (that
 * one's a physics-feel default for a world item's falling body; this one's
 * carry-weight enforcement's own default), so retuning one for its own
 * subsystem never silently retunes the other. */
const DEFAULT_ITEM_WEIGHT = 1;

/** *Per-unit* weight (kg) for an item type — for a `stackable` item (coins)
 * this is one coin's weight, not a whole pile's; multiply by however many
 * units are actually in play (`itemCount`/`stackWeightOf` below). */
function unitWeight(itemTypeId: string): number {
  return ITEM_REGISTRY[itemTypeId]?.mass ?? DEFAULT_ITEM_WEIGHT;
}

/** How many units `eid` currently represents — `Stackable.count[eid]` for a
 * commodity item (coins), or 1 for anything else (including a `Stackable`
 * entity that's been fully merged away and is sitting inert at 0, which
 * this correctly reports as 0, not 1). */
export function itemCount(world: World, eid: number): number {
  return hasComponent(world, eid, Stackable) ? Stackable.count[eid] : 1;
}

/** Weight (kg) of `eid`'s *entire current* stack — `unitWeight * itemCount`.
 * A pile of 50 coins really does weigh 50x one coin; stacking is purely an
 * inventory-slot convenience, never a weight loophole. */
function stackWeightOf(world: World, eid: number): number {
  return unitWeight(Item.itemTypeId[eid]) * itemCount(world, eid);
}

/** Total weight (kg) of every `Item` currently `Carried` by `ownerEid`, in
 * any slot — equipped or not, it's all still "on your person." A carried
 * item that's itself a `Container` (a backpack) has its own contents added
 * in too, recursively: a container raises how much you can carry
 * (`maxCarryWeight` below), it doesn't make what's inside it weightless —
 * zipping a sword into a backpack doesn't make it lighter, it just makes
 * room for it. Recursion never goes more than one level deep in practice
 * since a container can't be nested inside another (`game.ts`'s
 * `moveToContainer` guard), but this doesn't assume that itself. Only ever
 * called with the player as `ownerEid` today, but takes one generically
 * like `Carried.ownerEid` itself does. Exported for `inventory/store.ts`'s
 * running weight readout as well as the enforcement below. */
export function carriedWeight(world: World, ownerEid: number): number {
  let total = 0;
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== ownerEid) continue;
    total += stackWeightOf(world, eid);
    if (hasComponent(world, eid, Container)) total += carriedWeight(world, eid);
  }
  return total;
}

/** `BASE_CARRY_WEIGHT` plus every carried container's own
 * `ItemAssetDef.carryCapacityBonus` (a backpack) — directly carried only
 * (not recursive like `carriedWeight`): a backpack you're carrying raises
 * your cap regardless of what's in it, but a bonus-granting item stashed
 * *inside* a container doesn't compound (moot today anyway, since a
 * container can't hold another container). */
export function maxCarryWeight(world: World, ownerEid: number): number {
  let total = hasComponent(world, ownerEid, CarryCapacity) ? CarryCapacity.maxWeight[ownerEid] : BASE_CARRY_WEIGHT;
  for (const eid of query(world, [Item, Carried, Container])) {
    if (Carried.ownerEid[eid] !== ownerEid) continue;
    total += ITEM_REGISTRY[Item.itemTypeId[eid]]?.carryCapacityBonus ?? 0;
  }
  return total;
}

/** True if `itemEid`'s weight is already counted toward `ownerEid`'s total
 * (`carriedWeight`) — directly `Carried` by `ownerEid`, or nested inside a
 * `Container` that's itself directly `Carried` by `ownerEid` (the only
 * nesting depth possible). Lets `wouldExceedCarryWeight` tell "moving
 * something already on your person from one pocket to another" (weight-
 * neutral, e.g. taking an item out of a backpack you're carrying) apart
 * from "actually picking up more weight" (taking the same item out of a
 * barrel, or off the floor for the first time). */
function isAlreadyCountedFor(world: World, ownerEid: number, itemEid: number): boolean {
  if (!hasComponent(world, itemEid, Carried)) return false;
  const directOwner = Carried.ownerEid[itemEid];
  if (directOwner === ownerEid) return true;
  return hasComponent(world, directOwner, Carried) && Carried.ownerEid[directOwner] === ownerEid;
}

/** True if giving `quantity` units of `itemEid` to `ownerEid` — on top of
 * whatever `ownerEid` already carries — would push its total past
 * `maxCarryWeight`. `quantity` defaults to `itemEid`'s entire current count
 * (1 for a non-stackable item), i.e. "moving the whole thing"; pass an
 * explicit smaller amount to check a partial stack transfer (`giveItem`'s
 * own `quantity` parameter) before committing to it. No-ops to `false` if
 * `itemEid`'s weight is already counted toward that total
 * (`isAlreadyCountedFor`) — otherwise taking an item (or part of a stack)
 * back out of a backpack you're already carrying would double-count it
 * against its own total and could get refused even though nothing about
 * your total weight actually changed. Shared by `pickUpItem` below (a
 * fresh world pickup) and game.ts's container `moveToPlayer` action (taking
 * an item back out of a barrel/backpack), so the cap can't be dodged by
 * stashing items in a *world* container first and unloading them all back
 * out at once. */
export function wouldExceedCarryWeight(world: World, ownerEid: number, itemEid: number, quantity?: number): boolean {
  if (isAlreadyCountedFor(world, ownerEid, itemEid)) return false;
  const addedWeight = unitWeight(Item.itemTypeId[itemEid]) * (quantity ?? itemCount(world, itemEid));
  return carriedWeight(world, ownerEid) + addedWeight > maxCarryWeight(world, ownerEid);
}

/** Finds the `Stackable` entity `ownerEid` already carries of `itemTypeId`
 * (with a positive count — a 0-count, fully-merged-away one doesn't count
 * as "already has one"), other than `excludeEid` itself, or `undefined` if
 * there isn't one. */
function findStack(world: World, ownerEid: number, itemTypeId: string, excludeEid: number): number | undefined {
  for (const eid of query(world, [Item, Carried, Stackable])) {
    if (eid === excludeEid) continue;
    if (Carried.ownerEid[eid] !== ownerEid) continue;
    if (Item.itemTypeId[eid] !== itemTypeId) continue;
    if (Stackable.count[eid] <= 0) continue;
    return eid;
  }
  return undefined;
}

/** Number of distinct entities currently sitting in `ownerEid`'s main
 * inventory list (`Carried.slot === "inventory"`) — a multi-count
 * `Stackable` entity (a coin pile) is still just one entry, whatever its
 * count, and a 0-count merged-away one doesn't count at all. Doesn't look
 * at hand slots or anything zipped inside a carried container — see
 * `MAX_INVENTORY_SLOTS`'s doc comment for why those don't count against
 * this. */
function inventorySlotCount(world: World, ownerEid: number): number {
  let count = 0;
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== ownerEid) continue;
    if (Carried.slot[eid] !== "inventory") continue;
    if (hasComponent(world, eid, Stackable) && Stackable.count[eid] <= 0) continue;
    count++;
  }
  return count;
}

/** True if giving `itemEid` to `ownerEid`'s main inventory list (slot
 * `"inventory"`) would need a slot beyond `MAX_INVENTORY_SLOTS` — `false`
 * if `itemEid` would instead merge into a stack `ownerEid`'s list already
 * holds (`findStack`), since merging never spends a new slot regardless of
 * how full the list already is. Used by `pickUpItem` below (a fresh world
 * pickup) and game.ts's container `moveToPlayer`/`unequip` actions —
 * anywhere something is about to land in slot `"inventory"` specifically;
 * equipping into a hand slot or storing into a container never needs this
 * check, since neither targets the capped list. */
export function wouldExceedInventorySlots(world: World, ownerEid: number, itemEid: number): boolean {
  const itemTypeId = Item.itemTypeId[itemEid];
  if (hasComponent(world, itemEid, Stackable) && findStack(world, ownerEid, itemTypeId, itemEid) !== undefined) return false;
  return inventorySlotCount(world, ownerEid) >= MAX_INVENTORY_SLOTS;
}

/**
 * Gives `quantity` units of `itemEid` to `destOwnerEid` — the general
 * "hand this item to someone" mechanic behind a fresh world pickup
 * (`pickUpItem` below) and every container transfer (game.ts's
 * `moveToContainer`/`moveToPlayer` actions). `quantity` defaults to
 * `itemEid`'s entire current count (1 for a non-stackable item, i.e. "move
 * the whole thing").
 *
 * - **Not stackable, or moving the *entire* stack with no matching stack
 *   already at the destination:** `itemEid` itself becomes
 *   `destOwnerEid`'s (adding `Carried` if it never had it before — a fresh
 *   world pickup) — no new entity, exactly how every item move worked
 *   before stacking existed.
 * - **`destOwnerEid` already carries a stack of the same item type:** that
 *   stack's count grows by `quantity`, and `itemEid`'s own count shrinks by
 *   the same amount — down to 0, permanently inert, if the whole thing
 *   moved (see `Stackable`'s own doc comment for why that's fine to leave
 *   behind rather than destroy).
 * - **Moving *part* of a stack with no existing stack at the destination:**
 *   splits a freshly created entity off for the moved portion, leaving the
 *   remainder on `itemEid`.
 *
 * Callers that might increase someone's total weight (a fresh pickup, or
 * taking something out of a container) are expected to have already
 * checked `wouldExceedCarryWeight` with the same `quantity`; storing into a
 * container never needs that check (see game.ts's `moveToContainer`).
 */
export function giveItem(world: World, itemEid: number, destOwnerEid: number, quantity?: number): void {
  const itemTypeId = Item.itemTypeId[itemEid];
  const sourceCount = itemCount(world, itemEid);
  const moveQty = quantity ?? sourceCount;
  const isStackable = hasComponent(world, itemEid, Stackable);
  const existingStack = isStackable ? findStack(world, destOwnerEid, itemTypeId, itemEid) : undefined;

  if (existingStack !== undefined) {
    // Merges into a stack destOwnerEid already holds -- itemEid gives up
    // however much moved (down to 0 and permanently inert if the whole
    // thing did) rather than becoming a second stack of the same type.
    Stackable.count[existingStack] += moveQty;
    Stackable.count[itemEid] = sourceCount - moveQty;
  } else if (moveQty < sourceCount) {
    // No stack to merge into, but only part of it is moving -- split off a
    // fresh entity carrying just that amount, leaving itemEid behind (still
    // with its original owner) holding the remainder.
    const splitEid = addEntity(world);
    addComponent(world, splitEid, Item);
    addComponent(world, splitEid, Carried);
    addComponent(world, splitEid, Stackable);
    Item.itemTypeId[splitEid] = itemTypeId;
    Carried.ownerEid[splitEid] = destOwnerEid;
    Carried.slot[splitEid] = "inventory";
    Stackable.count[splitEid] = moveQty;
    Stackable.count[itemEid] = sourceCount - moveQty;
  }
  // else: the whole thing moved and there's no existing stack to merge into
  // -- itemEid itself becomes destOwnerEid's, keeping its current count
  // as-is (nothing to split off, nothing to zero out).

  if (moveQty >= sourceCount) {
    // The whole thing moved -- itemEid itself becomes destOwnerEid's (even
    // if it also just merged into an existing stack above, in which case
    // it's now permanently inert at count 0).
    addComponent(world, itemEid, Carried);
    Carried.ownerEid[itemEid] = destOwnerEid;
    Carried.slot[itemEid] = "inventory";
  }
}

/** What `pickUpItem` actually did — `"too-heavy"`/`"inventory-full"` let
 * callers (`doors.ts`) show the right refusal message rather than one
 * generic one, since a fresh pickup can be blocked for either reason
 * independently. */
export type PickUpResult = "picked-up" | "too-heavy" | "inventory-full";

/**
 * Picks up a world item: called from the `Item` branch of `tryInteract`
 * (doors.ts) when the interact raycast hits an `Item` entity that has no
 * `Carried` component yet. Gives the whole thing to `ownerEid` (`giveItem`)
 * — for a stackable item (coins) that merges into a stack `ownerEid`
 * already carries, exactly the same as any other stack-to-stack transfer —
 * and hides the item's in-world pickup mesh either way: hidden rather than
 * removed from the scene/ECS so a future "drop" could just flip it back to
 * visible, and so it stops showing up in `tryInteract`'s own interactable
 * list (that list explicitly skips any `Item` that already has `Carried`,
 * which `giveItem` always adds to `itemEid` regardless of whether it merged
 * away).
 *
 * Does nothing else and reports why if `ownerEid` is already carrying too
 * much (`wouldExceedCarryWeight`) or their inventory list is already full
 * (`wouldExceedInventorySlots`, checked second so a too-heavy pickup always
 * gets that message even when the list also happens to be full) —
 * `doors.ts` is expected to show a message either way and still treat the
 * interact as handled.
 */
export function pickUpItem(world: World, itemEid: number, ownerEid: number): PickUpResult {
  if (wouldExceedCarryWeight(world, ownerEid, itemEid)) return "too-heavy";
  if (wouldExceedInventorySlots(world, ownerEid, itemEid)) return "inventory-full";

  giveItem(world, itemEid, ownerEid);

  const obj = Object3DRef[itemEid];
  if (obj) obj.visible = false;

  // An embedded projectile's object is parented to whatever it struck, not
  // the scene (see `Embedded`'s doc comment) -- clear the tag once it's
  // picked up so a later drop (which always reparents a fresh mesh under
  // the scene, via `buildItemWorldBody`) gets the ordinary generic sync
  // back rather than staying permanently skipped by `syncSystem`.
  if (hasComponent(world, itemEid, Embedded)) removeComponent(world, itemEid, Embedded);

  // Disabled rather than removed from the physics world, for the same reason
  // the mesh is hidden rather than deleted: a future "drop" is then just
  // re-enabling it at the player's feet. A disabled body keeps its handle but
  // stops colliding and stops being simulated, so a carried sword can't be
  // kicked around the room by someone standing where it used to be.
  PhysicsBody[itemEid]?.setEnabled(false);
  return "picked-up";
}

/** Camera-relative offsets for each hand's viewmodel — lower corners of the
 * view, angled slightly inward, so a mesh in either hand reads as "held" up
 * close to the camera without covering the center of the screen.
 *
 * Retuned for issue #65's new sword shape (see assets/items/sword.ts): unlike the
 * old flat symmetric plank, the sword mesh's origin sits at its grip and
 * most of its length is the blade extending away from that origin, so a
 * naive Euler tilt (the old values) left almost the entire weapon — blade,
 * crossguard, grip — off-frame, with only the tip poking into view. These
 * `rot` values instead came from actually posing the mesh: put its grip at
 * `pos`, call `Object3D.prototype.lookAt` to aim the blade at a point up and
 * into the scene ahead of the camera, screenshot it, and read back the
 * resulting Euler angles (see this issue's PR description for the exact
 * before/after renders) — repeat for any future viewmodel mesh whose shape
 * changes enough to need this redone, rather than hand-picking numbers. */
const VIEWMODEL_OFFSET: Record<HandSlot, { pos: THREE.Vector3Tuple; rot: THREE.EulerTuple }> = {
  "hand-right": { pos: [0.26, -0.3, -0.4], rot: [-2.6135, -0.4198, -2.9082] },
  "hand-left": { pos: [-0.26, -0.3, -0.4], rot: [-2.6135, 0.4198, 2.9082] },
};

/**
 * Finds an open hand slot (`hand-left` before `hand-right`) among
 * everything `ownerEid` currently carries, or `undefined` if both are
 * occupied -- including "occupied by a two-handed weapon sitting in the
 * *other* hand" (`ItemAssetDef.twoHanded`, e.g. the crossbow): it needs both
 * hands to itself, so neither ever reads as open while it's equipped.
 */
export function findOpenHandSlot(world: World, ownerEid: number): HandSlot | undefined {
  let leftOpen = true;
  let rightOpen = true;
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== ownerEid) continue;
    const slot = Carried.slot[eid];
    if (!isHandSlot(slot)) continue;
    const twoHanded = !!ITEM_REGISTRY[Item.itemTypeId[eid]]?.twoHanded;
    if (slot === "hand-left") { leftOpen = false; if (twoHanded) rightOpen = false; }
    else { rightOpen = false; if (twoHanded) leftOpen = false; }
  }
  return leftOpen ? "hand-left" : rightOpen ? "hand-right" : undefined;
}

/**
 * Forces `mesh` (and everything under it) to render on top of the rest of
 * the scene regardless of actual depth — `renderOrder` past every ordinary
 * object's default of 0 draws it last, and `depthTest: false` means it wins
 * even where world geometry the camera has clipped into would otherwise be
 * nearer. A held viewmodel is meant to read as "closer than anything else
 * possibly could be," so it should never clip into a wall the way a normal
 * depth-sorted object would when the camera gets close enough to one.
 *
 * Clones each material rather than flipping the flags on the shared cached
 * one (`sword.ts`'s `metalMaterial()`/`gripMaterial()`, reused by both the
 * in-world pickup mesh and every viewmodel instance) — the in-world sword
 * lying on a table still needs normal depth testing against the floor/walls
 * around it.
 */
function makeRenderOnTop(mesh: THREE.Object3D): void {
  mesh.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.renderOrder = 999;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    const viewmodelMaterials = materials.map((material) => {
      // FPS items need a stable presentation independent of the dungeon's
      // lighting. In particular, a lantern is parented beside the other held
      // item and its PointLight used to blow out that weapon at close range.
      // MeshBasicMaterial retains each authored part's colour/texture but
      // deliberately ignores every scene light. This acts as the viewmodel's
      // own persistent fill without changing the in-world copy's materials.
      const source = material as THREE.Material & {
        color?: THREE.Color;
        map?: THREE.Texture | null;
        emissive?: THREE.Color;
        emissiveIntensity?: number;
        alphaTest?: number;
        vertexColors?: boolean;
      };
      const color = source.color?.clone() ?? new THREE.Color(0xffffff);
      if (source.emissive) {
        color.add(source.emissive.clone().multiplyScalar(source.emissiveIntensity ?? 1));
      }
      const stable = new THREE.MeshBasicMaterial({
        color,
        map: source.map ?? null,
        side: material.side,
        transparent: material.transparent,
        opacity: material.opacity,
        alphaTest: source.alphaTest ?? 0,
        vertexColors: source.vertexColors ?? false,
        fog: false,
        toneMapped: false,
      });
      stable.depthTest = false;
      stable.depthWrite = false;
      return stable;
    });
    // Preserve the original material shape. Assigning an array to geometry
    // without material groups makes three.js draw nothing.
    obj.material = Array.isArray(obj.material) ? viewmodelMaterials : viewmodelMaterials[0];
  });
}

/**
 * Equips a carried, equippable item into a specific hand slot: moves
 * `Carried.slot` there and, if the item type has a viewmodel look, attaches
 * it directly to the camera (`camera.add`, not the scene) at a fixed
 * camera-relative offset (see `VIEWMODEL_OFFSET`) — see `Viewmodel` in
 * components.ts for why this is a separate mesh from the item's in-world
 * `Object3DRef`. No-ops if the item isn't carried or isn't a `slot: "hand"`
 * item type. Does not check whether `slot` itself is already occupied by
 * something one-handed — callers (`equipToOpenHandSlot` below,
 * `inventory/store.ts`'s `tapSlot`) are expected to have picked/confirmed
 * an open one. A two-handed item (`ItemAssetDef.twoHanded`, e.g. the
 * crossbow) is the one case this *does* actively resolve either direction:
 * equipping one clears whatever's in the *other* hand first, and equipping
 * anything while a two-handed item already occupies either hand clears that
 * first — `findOpenHandSlot` already keeps `equipToOpenHandSlot` from ever
 * reaching this case, but `equipToSlot`'s explicit-slot path (a paper-doll
 * tap) bypasses that check entirely, so it's handled here instead, once,
 * for both callers.
 */
export function equipItem(world: World, camera: THREE.Camera, itemEid: number, slot: HandSlot): void {
  if (!hasComponent(world, itemEid, Carried)) return;
  const itemType = ITEM_REGISTRY[Item.itemTypeId[itemEid]];
  if (!itemType || itemType.slot !== "hand") return;

  const ownerEid = Carried.ownerEid[itemEid];
  const otherSlot: HandSlot = slot === "hand-left" ? "hand-right" : "hand-left";
  for (const otherEid of query(world, [Item, Carried])) {
    if (otherEid === itemEid || Carried.ownerEid[otherEid] !== ownerEid) continue;
    const otherOccupiedSlot = Carried.slot[otherEid];
    if (otherOccupiedSlot !== slot && otherOccupiedSlot !== otherSlot) continue;
    const otherType = ITEM_REGISTRY[Item.itemTypeId[otherEid]];
    if (itemType.twoHanded || otherType?.twoHanded) unequipItem(world, otherEid);
  }

  Carried.slot[itemEid] = slot;

  const mesh = itemType.createViewmodelMesh?.();
  if (mesh) {
    const custom = itemType.viewmodelTransform;
    const { pos, rot } = custom
      ? { pos: custom.position, rot: custom.rotation }
      : VIEWMODEL_OFFSET[slot];
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    makeRenderOnTop(mesh);
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

/**
 * Mounts `itemTypeId`'s viewmodel mesh directly onto `camera` at `slot`'s
 * offset, the same way `equipItem` does — but without `equipItem`'s
 * `Carried`/`Item` component checks, which need a real carried entity in a
 * live `World`. Used only by the standalone weapon-animation viewer
 * (`weapon.html`/`src/viewer/weaponWorkshop.ts`), which has no ECS world or
 * player to carry anything; it still sets `Carried.slot`/`Viewmodel` for
 * `itemEid` (both plain arrays, not real bitECS components — see their doc
 * comments in `ecs/components.ts`), so `viewmodelSwingSystem` drives the
 * mounted mesh identically to a real equipped weapon. Returns `false` if
 * `itemTypeId` doesn't exist or has no viewmodel mesh to show.
 */
export function debugMountViewmodel(camera: THREE.Camera, itemEid: number, itemTypeId: string, slot: HandSlot): boolean {
  const itemType = ITEM_REGISTRY[itemTypeId];
  const mesh = itemType?.createViewmodelMesh?.();
  if (!mesh) return false;
  debugUnmountViewmodel(itemEid);
  const custom = itemType.viewmodelTransform;
  const { pos, rot } = custom ? { pos: custom.position, rot: custom.rotation } : VIEWMODEL_OFFSET[slot];
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  makeRenderOnTop(mesh);
  camera.add(mesh);
  Carried.slot[itemEid] = slot;
  Viewmodel[itemEid] = mesh;
  return true;
}

/** Removes a mount made by `debugMountViewmodel`, if any — see its own doc
 * comment for why this doesn't just reuse `unequipItem`. */
export function debugUnmountViewmodel(itemEid: number): void {
  const mesh = Viewmodel[itemEid];
  if (mesh) {
    mesh.removeFromParent();
    Viewmodel[itemEid] = undefined;
  }
}

/**
 * Every numeric knob that shapes a viewmodel animation, gathered into one
 * mutable object rather than module-level constants — production code only
 * ever reads through `tuning` (below), so shipped behavior always runs on
 * `DEFAULT_TUNING` and never changes; the indirection exists purely so the
 * standalone weapon-animation viewer (`weapon.html`/`src/viewer/
 * weaponWorkshop.ts`) can retune any of these live, without a rebuild, in
 * place of the "edit a constant, reload, re-equip, re-attack" loop these
 * numbers used to require.
 */
export interface ViewmodelTuning {
  /** Seconds, roundtrip, for a released swing/jab's whole animation. */
  swingDuration: number;
  /** How far forward (meters) a jab's thrust carries at its peak. */
  stabDistance: number;
  /** How far (meters) a jab drifts toward screen-center at its peak. */
  stabInward: number;
  /** How long (seconds) the charged swing's held pose takes to rise into
   * its fully-raised windup once charging starts -- fast enough to feel
   * responsive, then it just sits there at full raise however much longer
   * the charge is actually held (see `viewmodelSwingSystem`'s "swing"
   * branch). */
  chargeRaiseSeconds: number;
  /** How far to the wound-up side (meters) the charged swing pulls back to
   * while held -- a right-handed swing chambers up and crossed toward the
   * right (see `handSign` in `viewmodelSwingSystem`), a left-handed one
   * toward the left, then releases in a full diagonal cut down and across
   * to the *opposite* side -- a real committed power-swing wind-up (think
   * cocking a bat back over one shoulder), not a small twitch. */
  sweepWind: number;
  /** How far *past* the resting center (meters) the release's
   * follow-through carries at its peak -- deliberately much wider than
   * `sweepWind`, large enough that the weapon's own origin (at its grip --
   * see `VIEWMODEL_OFFSET`'s doc comment) travels off the edge of the
   * screen during the cut, not just its blade tip. */
  sweepReach: number;
  /** Upward drift (meters) while winding up -- chambering the swing raises
   * the weapon up before it cuts down. */
  sweepRiseWind: number;
  /** Downward drift (meters, negative) at the release's follow-through
   * peak -- the cut continues down and across rather than staying level,
   * so the weapon ends up low and to the side rather than swinging flat. */
  sweepDropPeak: number;
  /** Yaw (radians) the blade turns toward while winding up/following
   * through -- what actually sells "the blade is cutting sideways" rather
   * than just the hilt translating in a straight line; `handSign` flips it
   * to always wind up opposite the follow-through side. */
  sweepYawWind: number;
  sweepYawReach: number;
  /** Roll (radians) layered on top of the yaw above, same wind/reach shape
   * -- gives the blade a bit of a slicing tilt rather than staying
   * perfectly flat through the whole arc. */
  sweepRollWind: number;
  sweepRollReach: number;
  /** How long (seconds) the held block's guard pose takes to rise once
   * block starts, and to lower once it releases -- fast enough to feel
   * like raising a guard on purpose, not a delayed reaction. */
  blockRaiseSeconds: number;
  blockLowerSeconds: number;
  /** Held-guard pose deltas from resting, all reaching full strength at
   * `blockRaiseSeconds`: raised toward chest/face height, pulled in toward
   * screen-center ("across the body"), and rolled hard enough toward
   * horizontal that the blade reads as a raised guard rather than its
   * normal resting angle. */
  blockRaise: number;
  blockInward: number;
  blockForward: number;
  blockPitch: number;
  blockRoll: number;
  /** How long (seconds) a freshly-interrupted animation blends from
   * wherever the viewmodel actually was into the new one's own trajectory,
   * instead of snapping -- see `applyViewmodelPose`. Short enough to still
   * feel responsive; long enough to hide the pop when, say, a held block
   * is released straight into a swing, or a charge is cancelled
   * mid-raise. */
  blendSeconds: number;
}

const DEFAULT_TUNING: Readonly<ViewmodelTuning> = {
  swingDuration: 0.26,
  stabDistance: 0.35,
  stabInward: 0.06,
  chargeRaiseSeconds: 0.15,
  sweepWind: 0.26,
  sweepReach: 0.62,
  sweepRiseWind: 0.09,
  sweepDropPeak: -0.28,
  sweepYawWind: 0.67,
  sweepYawReach: 1.0,
  sweepRollWind: 0.2,
  sweepRollReach: 0.55,
  blockRaiseSeconds: 0.15,
  blockLowerSeconds: 0.15,
  blockRaise: 0.14,
  blockInward: 0.09,
  blockForward: 0.08,
  blockPitch: 0.22,
  blockRoll: 1.1,
  blendSeconds: 0.08,
};

let tuning: ViewmodelTuning = { ...DEFAULT_TUNING };

/** The live tuning values every viewmodel animation currently reads --
 * a copy, so a caller can't mutate this module's actual state except
 * through `setViewmodelTuning`. */
export function getViewmodelTuning(): ViewmodelTuning {
  return { ...tuning };
}

/** Overrides one or more tuning values immediately -- every subsequent
 * `viewmodelSwingSystem` frame (and any new `triggerViewmodelSwing` call,
 * for `swingDuration`) picks them up. Only the standalone weapon-animation
 * viewer calls this today; production code never does, so shipped behavior
 * always runs on `DEFAULT_TUNING`. */
export function setViewmodelTuning(patch: Partial<ViewmodelTuning>): void {
  Object.assign(tuning, patch);
}

/** Restores every tuning value to its shipped default. */
export function resetViewmodelTuning(): void {
  tuning = { ...DEFAULT_TUNING };
}

interface SwingState {
  itemEid: number;
  elapsed: number;
  attackType: import("./combat").AttackType | "block" | "cancel";
  duration: number;
  /** True only for a `"swing"`/`"block"` entry that's still being held (see
   * `startViewmodelCharge`/`startViewmodelBlock`) -- while true,
   * `viewmodelSwingSystem` drives the raised pose from `chargeElapsed` below
   * instead of `elapsed`/`duration`, and the entry never expires on its own
   * no matter how long it's held. */
  charging: boolean;
  /** Seconds spent charging/held so far -- only ever read while `charging`
   * is true; irrelevant (and unused) once released. */
  chargeElapsed: number;
  /** The viewmodel's actual pose at the instant this entry was created, or
   * `undefined` once the blend into this entry's own trajectory has
   * finished (or never needed one -- see `applyViewmodelPose`'s doc
   * comment). Left unset when a state continues seamlessly out of another
   * (e.g. a charge releasing into its own swing, which always starts at
   * exactly the pose the held charge already ended at). */
  blendFrom?: { pos: THREE.Vector3Tuple; rot: THREE.EulerTuple };
  /** Seconds into the blend above -- only meaningful while `blendFrom` is
   * set. */
  blendElapsed: number;
}

/** The viewmodel's current actual transform, for a fresh `SwingState` to
 * blend in from (`applyViewmodelPose`) -- `undefined` for an item with no
 * viewmodel mesh right now (unarmed, or unequipped mid-animation), in which
 * case there's nothing to blend from and the caller just skips it. */
function captureBlendFrom(itemEid: number): { pos: THREE.Vector3Tuple; rot: THREE.EulerTuple } | undefined {
  const mesh = Viewmodel[itemEid];
  if (!mesh) return undefined;
  return { pos: [mesh.position.x, mesh.position.y, mesh.position.z], rot: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] };
}

/** Items currently mid-swing (see `triggerViewmodelSwing`/
 * `viewmodelSwingSystem` below) — a plain array since there's realistically
 * at most one or two entries (one per hand) at once. */
const activeSwings: SwingState[] = [];

/** Debug/test hook (see `window.__vibeDungeonDebug.getViewmodelAnimationState`
 * in game.ts) exposing every active viewmodel animation's own clock --
 * lets automated (Playwright) testing wait for a specific animation phase
 * (e.g. "charge is at least half-raised", "release is past its midpoint")
 * by polling actual progress, rather than guessing a wall-clock delay that
 * a slow/throttled render loop can blow straight through in a single
 * frame. */
export function getViewmodelAnimationDebugState(): { itemEid: number; attackType: string; charging: boolean; elapsed: number; duration: number; chargeElapsed: number }[] {
  return activeSwings.map((s) => ({ itemEid: s.itemEid, attackType: s.attackType, charging: s.charging, elapsed: s.elapsed, duration: s.duration, chargeElapsed: s.chargeElapsed }));
}

/** Starts (or restarts, if already swinging) a weapon-swing animation for
 * `itemEid`'s viewmodel — called from `tryMeleeAttack` (combat.ts) on every
 * attack attempt, hit or miss, since the swing is what the player *did*,
 * not a reaction to a hit. No-ops harmlessly next frame in
 * `viewmodelSwingSystem` if the item turns out not to have a viewmodel
 * (unarmed) or gets unequipped mid-swing.
 *
 * If `itemEid` is currently *charging* a swing (`startViewmodelCharge`
 * below), this is `releaseSwingCharge` (combat.ts) actually throwing it --
 * rather than resetting `elapsed` to 0, which would visibly snap the
 * viewmodel back down to resting before instantly re-raising it, this just
 * flips `charging` off and hands the entry a fresh release `duration`:
 * `viewmodelSwingSystem`'s "swing" release phase always *starts* at the
 * exact same fully-raised pose the held charge was already sitting in, so
 * the transition is seamless. */
export function triggerViewmodelSwing(itemEid: number, attackType: import("./combat").AttackType = "jab", duration = tuning.swingDuration): void {
  const existing = activeSwings.find((s) => s.itemEid === itemEid);
  if (existing?.charging) {
    // Continuing straight out of a held charge/block -- already sitting in
    // exactly this release's own start pose, so no blend-in needed.
    existing.charging = false;
    existing.elapsed = 0;
    existing.attackType = attackType;
    existing.duration = duration;
    existing.blendFrom = undefined;
    return;
  }
  const blendFrom = captureBlendFrom(itemEid);
  if (existing) Object.assign(existing, { elapsed: 0, chargeElapsed: 0, attackType, duration, charging: false, blendFrom, blendElapsed: 0 });
  else activeSwings.push({ itemEid, elapsed: 0, chargeElapsed: 0, attackType, duration, charging: false, blendFrom, blendElapsed: 0 });
}

/** Starts holding `itemEid`'s viewmodel raised in the charged-swing windup
 * pose -- the Skyrim-style "hold attack to charge a power swing" mechanic
 * (combat.ts's `tryStartSwingCharge`) -- until `triggerViewmodelSwing` is
 * called again for the same item (the release, see its own doc comment
 * above) or `cancelViewmodelCharge` drops it. */
export function startViewmodelCharge(itemEid: number): void {
  const blendFrom = captureBlendFrom(itemEid);
  const existing = activeSwings.find((s) => s.itemEid === itemEid);
  if (existing) Object.assign(existing, { elapsed: 0, chargeElapsed: 0, attackType: "swing" as const, duration: 0, charging: true, blendFrom, blendElapsed: 0 });
  else activeSwings.push({ itemEid, elapsed: 0, chargeElapsed: 0, attackType: "swing", duration: 0, charging: true, blendFrom, blendElapsed: 0 });
}

/** Cancels a charge started by `startViewmodelCharge` without ever
 * swinging -- e.g. a modal opening mid-charge (game.ts) -- easing the
 * viewmodel back to its resting pose (see `applyViewmodelPose`) rather than
 * playing out any part of the swing or snapping instantly. */
export function cancelViewmodelCharge(itemEid: number): void {
  const i = activeSwings.findIndex((s) => s.itemEid === itemEid && s.charging);
  if (i === -1) return;
  const blendFrom = captureBlendFrom(itemEid);
  activeSwings[i] = { itemEid, elapsed: 0, chargeElapsed: 0, attackType: "cancel", duration: 0, charging: false, blendFrom, blendElapsed: 0 };
}

/** Starts (or keeps) holding `itemEid`'s viewmodel raised in the block guard
 * pose -- called every frame block is held (`combat.ts`'s `setBlocking`), a
 * no-op once already raised so the held pose doesn't keep resetting its own
 * rise timer while the block key just stays down. */
export function startViewmodelBlock(itemEid: number): void {
  const existing = activeSwings.find((s) => s.itemEid === itemEid);
  if (existing?.attackType === "block" && existing.charging) return;
  const blendFrom = captureBlendFrom(itemEid);
  if (existing) Object.assign(existing, { elapsed: 0, chargeElapsed: 0, attackType: "block" as const, duration: 0, charging: true, blendFrom, blendElapsed: 0 });
  else activeSwings.push({ itemEid, elapsed: 0, chargeElapsed: 0, attackType: "block", duration: 0, charging: true, blendFrom, blendElapsed: 0 });
}

/** Lowers a guard raised by `startViewmodelBlock` back to resting over
 * `BLOCK_LOWER_SECONDS` -- called once block releases (`combat.ts`'s
 * `setBlocking`). */
export function stopViewmodelBlock(itemEid: number): void {
  const existing = activeSwings.find((s) => s.itemEid === itemEid && s.attackType === "block" && s.charging);
  if (!existing) return;
  existing.charging = false;
  existing.elapsed = 0;
  existing.duration = tuning.blockLowerSeconds;
}

/** Applies `swing`'s computed target pose to `mesh` for this frame --
 * directly, unless `swing.blendFrom` is still set, in which case it eases
 * from that captured starting pose into `targetPos`/`targetRot` over
 * `BLEND_SECONDS` first. Every phase below (charge, block, release, jab,
 * cancel) computes its own target purely as a function of the
 * thing this adds is *how* that target gets applied for the first instant
 * after a new animation interrupts whatever the viewmodel was previously
 * doing, so switching from one attack into another (or into/out of a held
 * block) blends rather than pops. Once the blend window elapses,
 * `blendFrom` clears itself and every later frame this frame's `else`
 * branch runs directly again, so this costs nothing once an animation is
 * already underway. */
function applyViewmodelPose(mesh: THREE.Object3D, swing: SwingState, dt: number, targetPos: THREE.Vector3Tuple, targetRot: THREE.EulerTuple): void {
  const from = swing.blendFrom;
  if (!from) {
    mesh.position.set(...targetPos);
    mesh.rotation.set(...targetRot);
    return;
  }
  swing.blendElapsed += dt;
  const t = Math.min(1, swing.blendElapsed / tuning.blendSeconds);
  const eased = 1 - (1 - t) * (1 - t); // ease-out: fast at first, settles into the target rather than arriving linearly
  mesh.position.set(
    from.pos[0] + (targetPos[0] - from.pos[0]) * eased,
    from.pos[1] + (targetPos[1] - from.pos[1]) * eased,
    from.pos[2] + (targetPos[2] - from.pos[2]) * eased,
  );
  mesh.rotation.set(
    from.rot[0] + (targetRot[0] - from.rot[0]) * eased,
    from.rot[1] + (targetRot[1] - from.rot[1]) * eased,
    from.rot[2] + (targetRot[2] - from.rot[2]) * eased,
  );
  if (t >= 1) swing.blendFrom = undefined;
}

/**
 * Advances every active weapon animation, driving each item's `Viewmodel`
 * mesh through whichever of jab/swing/block/cancel it's currently in
 * (see each trigger function's own doc comment for when each starts).
 * Reads `Carried.slot` each frame (rather than caching the hand at
 * swing-start) so re-equipping mid-animation doesn't leave the mesh
 * animating around a stale offset. Must run every frame (called
 * unconditionally from game.ts's loop, not just when attacking) so an
 * animation already in progress keeps advancing on frames with no new
 * input.
 *
 * - **jab**: a forward stab/thrust, not a swing -- only `position` moves
 *   (further along -Z, camera-forward, plus a slight drift toward
 *   screen-center), `rotation` stays exactly at its resting
 *   `VIEWMODEL_OFFSET` pose throughout, which is what makes it read as the
 *   blade driving point-first rather than swinging through an arc.
 * - **swing**: the held power attack -- chambers up and toward one side
 *   (`SWEEP_WIND`/`SWEEP_RISE_WIND`, `handSign` below), then on release
 *   cuts down and across to a wide follow-through on the *other* side
 *   (`SWEEP_REACH`/`SWEEP_DROP_PEAK`) -- far enough that the weapon's own
 *   grip travels off the edge of the screen, not just its blade tip.
 *   `handSign` mirrors which side is which by hand, so a right-handed
 *   weapon chambers right and cuts down-and-left and a left-handed one is
 *   the exact mirror.
 * - **block**: a genuinely held guard (`startViewmodelBlock`/
 *   `stopViewmodelBlock`) raised toward chest height, pulled in across the
 *   body, and rolled toward horizontal for as long as block is actually
 *   held -- not a fixed-length animation at all, driven the same "held,
 *   resets on release" way `swing`'s own charge is.
 * - **cancel**: no motion of its own -- just eases back to the resting pose
 *   via `applyViewmodelPose`'s blend and then removes itself, for a charge
 *   dropped without ever swinging (`cancelViewmodelCharge`).
 *
 * Eases in and out via `sin(t * PI)` (0 at both ends, 1 at the midpoint) so
 * a one-shot animation doesn't snap at either end; `applyViewmodelPose`
 * additionally smooths the first instant of *any* phase change (see its own
 * doc comment) so interrupting one animation with another blends instead of
 * popping.
 */
export function viewmodelSwingSystem(dt: number): void {
  for (let i = activeSwings.length - 1; i >= 0; i--) {
    const swing = activeSwings[i];
    const slot = Carried.slot[swing.itemEid];
    const mesh = Viewmodel[swing.itemEid];
    if (!mesh || !isHandSlot(slot)) {
      activeSwings.splice(i, 1);
      continue;
    }

    // hand-right sits at a positive resting X, hand-left at negative — this
    // sign always points back toward screen-center regardless of which hand.
    const inwardSign = slot === "hand-right" ? -1 : 1;
    // Which side a swing chambers toward versus follows through toward --
    // a right-handed cut winds up to the right (handSign positive) and
    // follows through down-and-left, the mirror image for a left-handed
    // one.
    const handSign = slot === "hand-right" ? 1 : -1;
    const base = VIEWMODEL_OFFSET[slot];

    if (swing.attackType === "cancel") {
      applyViewmodelPose(mesh, swing, dt, base.pos, base.rot);
      if (!swing.blendFrom) activeSwings.splice(i, 1);
      continue;
    }

    if (swing.attackType === "block") {
      if (swing.charging) {
        // Held phase: rise into the guard and then just sit there, however
        // long block is actually held.
        swing.chargeElapsed += dt;
        const raise = Math.min(1, swing.chargeElapsed / tuning.blockRaiseSeconds);
        applyViewmodelPose(mesh, swing, dt,
          [base.pos[0] + inwardSign * tuning.blockInward * raise, base.pos[1] + tuning.blockRaise * raise, base.pos[2] + tuning.blockForward * raise],
          [base.rot[0] + tuning.blockPitch * raise, base.rot[1], base.rot[2] + inwardSign * tuning.blockRoll * raise]);
        continue;
      }
      // Release lowers the guard back to resting over tuning.blockLowerSeconds.
      swing.elapsed += dt;
      const t = Math.min(1, swing.elapsed / swing.duration);
      const lower = 1 - t;
      applyViewmodelPose(mesh, swing, dt,
        [base.pos[0] + inwardSign * tuning.blockInward * lower, base.pos[1] + tuning.blockRaise * lower, base.pos[2] + tuning.blockForward * lower],
        [base.rot[0] + tuning.blockPitch * lower, base.rot[1], base.rot[2] + inwardSign * tuning.blockRoll * lower]);
      if (t >= 1) activeSwings.splice(i, 1);
      continue;
    }

    if (swing.attackType === "swing") {
      if (swing.charging) {
        // Held phase: chamber up and toward handSign's side and then just
        // sit there, however long the charge is actually held -- no sweep
        // motion at all yet (that's the release phase below, which always
        // starts from exactly this same fully-chambered chamber=1 pose).
        swing.chargeElapsed += dt;
        const chamber = Math.min(1, swing.chargeElapsed / tuning.chargeRaiseSeconds);
        applyViewmodelPose(mesh, swing, dt,
          [base.pos[0] + handSign * tuning.sweepWind * chamber, base.pos[1] + tuning.sweepRiseWind * chamber, base.pos[2]],
          [base.rot[0], base.rot[1] + handSign * tuning.sweepYawWind * chamber, base.rot[2] + handSign * tuning.sweepRollWind * chamber]);
        continue;
      }
      // Release phase: the chambered weapon cuts down and across to a wide
      // follow-through on the opposite side and settles back to rest --
      // chamber unwinds 1 -> 0 across the same span arc sweeps through its
      // own 0 -> 1 -> 0, so both hit their resting values (chamber=0,
      // arc=0) together right as the swing finishes.
      swing.elapsed += dt;
      const releaseT = Math.min(1, swing.elapsed / swing.duration);
      const chamber = 1 - releaseT;
      const arc = Math.sin(releaseT * Math.PI);
      applyViewmodelPose(mesh, swing, dt,
        [base.pos[0] + handSign * tuning.sweepWind * chamber - handSign * tuning.sweepReach * arc, base.pos[1] + tuning.sweepRiseWind * chamber + tuning.sweepDropPeak * arc, base.pos[2]],
        [base.rot[0], base.rot[1] + handSign * tuning.sweepYawWind * chamber - handSign * tuning.sweepYawReach * arc, base.rot[2] + handSign * tuning.sweepRollWind * chamber - handSign * tuning.sweepRollReach * arc]);
      if (releaseT >= 1) activeSwings.splice(i, 1);
      continue;
    }

    // "jab"
    swing.elapsed += dt;
    const t = Math.min(1, swing.elapsed / swing.duration);
    const arc = Math.sin(t * Math.PI);
    applyViewmodelPose(mesh, swing, dt,
      [base.pos[0] + inwardSign * tuning.stabInward * arc, base.pos[1], base.pos[2] - arc * tuning.stabDistance],
      base.rot);

    if (t >= 1) activeSwings.splice(i, 1);
  }
}
