import * as THREE from "three";
import { addComponent, addEntity, hasComponent, query, type World } from "bitecs";
import { Carried, Item, Object3DRef, PhysicsBody, Stackable, Viewmodel, type CarriedSlot } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";

export type HandSlot = "hand-left" | "hand-right";

/** Exported for combat.ts (checking whether an item is equipped in *a* hand,
 * not which one) as well as internal use here. */
export function isHandSlot(slot: CarriedSlot): slot is HandSlot {
  return slot === "hand-left" || slot === "hand-right";
}

/** Max total weight (kg) of what the player carries directly — main
 * inventory list plus both hand slots, but *not* whatever's zipped inside a
 * carried backpack (see `wouldExceedContainerWeight` below for that
 * container's own, separate budget) — reusing `ItemAssetDef.mass`
 * (previously only a physics-feel knob for a world item's falling/
 * skittering body, see `boxShapeOf`/`addDynamicBox` in level/spawning.ts)
 * as each item's carry weight too, rather than adding a second, separate
 * "weight" field every asset would need to declare. A carried backpack
 * doesn't raise this cap: it gives its *contents* their own separate
 * capacity instead (see below), so the extra room only ever helps what
 * stays zipped inside it. Tuned against the level's current item set
 * (sword 3 + lantern 1.4 + everything else adds up past 5) so grabbing a
 * couple of the heavier pieces is fine, but trying to carry literally
 * everything at once directly isn't. */
export const BASE_CARRY_WEIGHT = 5;

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

/** Total weight (kg) of every `Item` directly `Carried` by `ownerEid` — not
 * recursive: a container's own contents are a separate pool with their own
 * cap (`wouldExceedContainerWeight`), not part of whoever carries the
 * container's own total. A 0-count `Stackable` entity (one merged into
 * another stack — see `giveItem` below) contributes nothing, same as it
 * being skipped everywhere else. Used both for the player (their main
 * inventory + hand slots, in any slot — equipped or not, it's all still "on
 * your person") and, with a container's own eid as `ownerEid`, for that
 * container's contents weight. Exported for `inventory/store.ts`'s running
 * weight readout and `container/sync.ts`'s (for a weight-capped container
 * like a backpack) as well as the enforcement below. */
export function carriedWeight(world: World, ownerEid: number): number {
  let total = 0;
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== ownerEid) continue;
    total += stackWeightOf(world, eid);
  }
  return total;
}

/** `Infinity` for anything that isn't a weight-capped container (a barrel,
 * or any item without `ItemAssetDef.containerWeightCapacity` set) — only a
 * backpack declares one today. Exported for `container/sync.ts`'s panel
 * readout (a backpack shows "weight / cap" the same way the main inventory
 * panel does; a barrel's `Infinity` tells the panel not to show one). */
export function containerWeightCapacityOf(itemTypeId: string): number {
  return ITEM_REGISTRY[itemTypeId]?.containerWeightCapacity ?? Infinity;
}

/** True if giving `quantity` units of `itemEid` to `ownerEid`'s *main*
 * carried weight — on top of whatever they already directly carry — would
 * push it past `BASE_CARRY_WEIGHT`. `quantity` defaults to `itemEid`'s
 * entire current count (1 for a non-stackable item), i.e. "moving the whole
 * thing"; pass an explicit smaller amount to check a partial stack transfer
 * (`giveItem`'s own `quantity` parameter) before committing to it. Always a
 * real addition to that total now, even for an item coming out of a
 * backpack the player is already carrying: a backpack's contents are their
 * own separate pool (`carriedWeight` isn't recursive), so pulling something
 * out of it and into the main inventory list genuinely adds to the main
 * total, exactly like pulling it out of a barrel or off the floor for the
 * first time would. Shared by `pickUpItem` below (a fresh world pickup) and
 * game.ts's container `moveToPlayer` action (taking an item, or part of a
 * stack, back out of a barrel/backpack). */
export function wouldExceedCarryWeight(world: World, ownerEid: number, itemEid: number, quantity?: number): boolean {
  const addedWeight = unitWeight(Item.itemTypeId[itemEid]) * (quantity ?? itemCount(world, itemEid));
  return carriedWeight(world, ownerEid) + addedWeight > BASE_CARRY_WEIGHT;
}

/** True if giving `quantity` units of `itemEid` to `containerEid` (a
 * backpack) — on top of whatever it already holds — would push its own
 * contents past its `ItemAssetDef.containerWeightCapacity`. `quantity`
 * defaults the same way `wouldExceedCarryWeight` does. Always `false` for
 * anything without a cap of its own (a barrel), so storing into a barrel
 * stays unconditionally free, same as before this cap existed. Used by
 * game.ts's container `moveToContainer` action. */
export function wouldExceedContainerWeight(world: World, containerEid: number, itemEid: number, quantity?: number): boolean {
  const cap = containerWeightCapacityOf(Item.itemTypeId[containerEid]);
  if (!Number.isFinite(cap)) return false;
  const addedWeight = unitWeight(Item.itemTypeId[itemEid]) * (quantity ?? itemCount(world, itemEid));
  return carriedWeight(world, containerEid) + addedWeight > cap;
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
 * Callers are expected to have already checked weight
 * (`wouldExceedCarryWeight`/`wouldExceedContainerWeight`, which both take
 * the same `quantity`).
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
 * Returns false (and does nothing else) if `ownerEid` is already carrying
 * too much (`wouldExceedCarryWeight`) — callers (`doors.ts`) are expected to
 * show a message and still treat the interact as handled either way.
 */
export function pickUpItem(world: World, itemEid: number, ownerEid: number): boolean {
  if (wouldExceedCarryWeight(world, ownerEid, itemEid)) return false;

  giveItem(world, itemEid, ownerEid);

  const obj = Object3DRef[itemEid];
  if (obj) obj.visible = false;

  // Disabled rather than removed from the physics world, for the same reason
  // the mesh is hidden rather than deleted: a future "drop" is then just
  // re-enabling it at the player's feet. A disabled body keeps its handle but
  // stops colliding and stops being simulated, so a carried sword can't be
  // kicked around the room by someone standing where it used to be.
  PhysicsBody[itemEid]?.setEnabled(false);
  return true;
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
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    obj.material = materials.map((m) => {
      const clone = m.clone();
      clone.depthTest = false;
      clone.depthWrite = false;
      return clone;
    });
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

  const mesh = itemType.createViewmodelMesh?.();
  if (mesh) {
    const { pos, rot } = VIEWMODEL_OFFSET[slot];
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

const SWING_DURATION = 0.22; // seconds, roundtrip
const STAB_DISTANCE = 0.35; // meters, how far forward the blade thrusts at the peak
const STAB_INWARD = 0.06; // meters, drifts toward screen-center at the peak

interface SwingState {
  itemEid: number;
  elapsed: number;
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
export function triggerViewmodelSwing(itemEid: number): void {
  const existing = activeSwings.find((s) => s.itemEid === itemEid);
  if (existing) existing.elapsed = 0;
  else activeSwings.push({ itemEid, elapsed: 0 });
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
    const t = Math.min(1, swing.elapsed / SWING_DURATION);
    const arc = Math.sin(t * Math.PI);
    // hand-right sits at a positive resting X, hand-left at negative — this
    // sign always points back toward screen-center regardless of which hand.
    const inwardSign = slot === "hand-right" ? -1 : 1;
    const base = VIEWMODEL_OFFSET[slot];

    mesh.position.set(base.pos[0] + inwardSign * STAB_INWARD * arc, base.pos[1], base.pos[2] - arc * STAB_DISTANCE);
    mesh.rotation.set(...base.rot);

    if (t >= 1) activeSwings.splice(i, 1);
  }
}
