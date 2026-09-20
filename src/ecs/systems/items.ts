import * as THREE from "three";
import { attachFirstPersonWeapon, detachFirstPersonWeapon, isFirstPersonWeapon, playFirstPersonAttack } from "./firstPersonArms";
import { addComponent, addEntity, hasComponent, query, type World } from "bitecs";
import { Carried, Container, Item, Object3DRef, PhysicsBody, Stackable, Viewmodel, type CarriedSlot } from "../components";
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
  let total = BASE_CARRY_WEIGHT;
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
    const wasArray = Array.isArray(obj.material);
    const materials: THREE.Material[] = wasArray ? obj.material : [obj.material];
    const clones = materials.map((m) => {
      const clone = m.clone();
      clone.depthTest = false;
      clone.depthWrite = false;
      return clone;
    });
    obj.material = wasArray ? clones : clones[0];
  });
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
  const itemType = ITEM_REGISTRY[Item.itemTypeId[itemEid]];
  if (!itemType || itemType.slot !== "hand") return;

  Carried.slot[itemEid] = slot;

  // Melee weapons live in the hand bone of the camera-mounted arm rig, so
  // they inherit the exact humanoid combat clips. Ranged weapons retain
  // their purpose-built camera transform/reload motion.
  const meleeViewmodel = itemType.meleeDamage !== undefined && !itemType.rangedWeapon;
  const mesh = meleeViewmodel ? itemType.createWorldMesh() : itemType.createViewmodelMesh?.();
  if (mesh) {
    if (meleeViewmodel) {
      attachFirstPersonWeapon(itemEid, slot, mesh, itemType.id === "dagger");
      Viewmodel[itemEid] = mesh;
      return;
    }
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
    detachFirstPersonWeapon(itemEid);
    mesh.removeFromParent();
    Viewmodel[itemEid] = undefined;
  }
}

const SWING_DURATION = 0.22; // seconds, roundtrip
const STAB_DISTANCE = 0.35; // meters, how far forward the blade thrusts at the peak
const STAB_INWARD = 0.06; // meters, drifts toward screen-center at the peak

interface SwingState {
  itemEid: number;
  elapsed: number;
  attackType: import("./combat").AttackType | "parry";
  duration: number;
}

/** Items currently mid-swing (see `triggerViewmodelSwing`/
 * `viewmodelSwingSystem` below) — a plain array since there's realistically
 * at most one or two entries (one per hand) at once. */
const activeSwings: SwingState[] = [];

/** Starts (or restarts, if already swinging) a weapon-swing animation for
 * `itemEid`'s viewmodel — called from `tryMeleeAttack` (combat.ts) on every
 * attack attempt, hit or miss, since the swing is what the player *did*,
 * not a reaction to a hit. No-ops harmlessly next frame in
 * `viewmodelSwingSystem` if the item turns out not to have a viewmodel
 * (unarmed) or gets unequipped mid-swing. */
export function triggerViewmodelSwing(itemEid: number, attackType: import("./combat").AttackType = "jab", duration = SWING_DURATION): void {
  if (isFirstPersonWeapon(itemEid)) {
    playFirstPersonAttack(attackType, true);
    return;
  }
  const existing = activeSwings.find((s) => s.itemEid === itemEid);
  if (existing) Object.assign(existing, { elapsed: 0, attackType, duration });
  else activeSwings.push({ itemEid, elapsed: 0, attackType, duration });
}

export function triggerViewmodelParry(itemEid: number, duration: number): void {
  if (isFirstPersonWeapon(itemEid)) {
    playFirstPersonAttack("parry", true);
    return;
  }
  const existing = activeSwings.find((s) => s.itemEid === itemEid);
  if (existing) Object.assign(existing, { elapsed: 0, attackType: "parry" as const, duration });
  else activeSwings.push({ itemEid, elapsed: 0, attackType: "parry", duration });
}

/**
 * Advances every active weapon attack, animating each attacking item's
 * `Viewmodel` mesh straight out toward the reticle and back — a forward
 * stab/thrust, not a rotated chop: only `position` moves (further along
 * -Z, camera-forward, plus a slight drift toward screen-center), `rotation`
 * stays exactly at its resting `VIEWMODEL_OFFSET` pose throughout, which is
 * what makes it read as the blade driving point-first rather than swinging
 * through an arc. Eases in and out via `sin(t * PI)` (0 at both ends, 1 at
 * the midpoint) so it doesn't snap at either end. Reads `Carried.slot` each
 * frame (rather than caching the hand at swing-start) so re-equipping
 * mid-swing doesn't leave the mesh animating around a stale offset. Must
 * run every frame (called unconditionally from game.ts's loop, not just
 * when attacking) so an attack already in progress keeps advancing on
 * frames with no new input.
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

    swing.elapsed += dt;
    const t = Math.min(1, swing.elapsed / swing.duration);
    const arc = Math.sin(t * Math.PI);
    // hand-right sits at a positive resting X, hand-left at negative — this
    // sign always points back toward screen-center regardless of which hand.
    const inwardSign = slot === "hand-right" ? -1 : 1;
    const base = VIEWMODEL_OFFSET[slot];

    if (swing.attackType === "parry") {
      mesh.position.set(base.pos[0] + inwardSign * .20 * arc, base.pos[1] + .15 * arc, base.pos[2] - .06 * arc);
      mesh.rotation.set(base.rot[0] - .25 * arc, base.rot[1] + inwardSign * .75 * arc, base.rot[2] + inwardSign * 1.15 * arc);
    } else if (swing.attackType === "jab") {
      mesh.position.set(base.pos[0] + inwardSign * STAB_INWARD * arc, base.pos[1], base.pos[2] - arc * STAB_DISTANCE);
      mesh.rotation.set(...base.rot);
    } else if (swing.attackType === "cross") {
      mesh.position.set(base.pos[0] + inwardSign * .18 * arc, base.pos[1] + .03 * arc, base.pos[2] - .18 * arc);
      mesh.rotation.set(base.rot[0], base.rot[1] + inwardSign * .9 * arc, base.rot[2] + inwardSign * .45 * arc);
    } else {
      const chamber = Math.sin(Math.min(1, t * 2) * Math.PI / 2);
      mesh.position.set(base.pos[0] + inwardSign * .08 * arc, base.pos[1] + .12 * chamber - .16 * arc, base.pos[2] - .16 * arc);
      mesh.rotation.set(base.rot[0] - .95 * chamber + 1.7 * arc, base.rot[1], base.rot[2] + inwardSign * .22 * arc);
    }

    if (t >= 1) activeSwings.splice(i, 1);
  }
}
