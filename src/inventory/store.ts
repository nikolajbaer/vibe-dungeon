import { makeAutoObservable } from "mobx";
import type { CarriedSlot } from "../ecs/components";

/** The two paper-doll slots a hand item can actually go in — duplicated
 * from `HandSlot` in `ecs/systems/items.ts` (rather than imported) so this
 * module's public type surface doesn't reach into `ecs/systems/*` for a
 * two-string union. */
export type HandSlot = "hand-left" | "hand-right";

function isHandSlot(slot: CarriedSlot): slot is HandSlot {
  return slot === "hand-left" || slot === "hand-right";
}

/** One carried item's UI-facing view — a plain snapshot written each frame
 * by `inventorySync` (mirrors `hudStore`'s `setHealth`), never read/written
 * directly by ECS code. */
export interface CarriedItemView {
  eid: number;
  itemTypeId: string;
  name: string;
  icon: string;
  equippable: boolean;
  /** True for a scroll (an `ItemSpawn` with `pages` — see
   * `ecs/components.ts`'s `Readable`). Tapping a readable item in the
   * inventory list opens the paged reader (`notice/store.ts`) instead of
   * equipping — see `InventoryList.tsx`, which handles this itself rather
   * than through `inventoryStore`, since reading never mutates ECS state
   * the way equip/unequip do. */
  readable: boolean;
  slot: CarriedSlot;
}

/**
 * The reverse-direction wiring the HUD never needed (see README Design
 * Notes, "Inventory pattern"): a tap has to *mutate* ECS state (equip/
 * unequip), but this store — like the rest of src/hud/*'s pattern it
 * mirrors — has no reference to the bitecs `world` or the camera. Instead
 * `game.ts` builds a small actions object that closes over both and hands
 * it to the store once at mount time (`bindActions`); Preact components
 * only ever call `inventoryStore.equip`/`unequip`, never reach into ECS
 * themselves.
 */
export interface InventoryActions {
  /** Equips `itemEid` into whichever hand slot is open; no-ops (silently)
   * if both hands are full or the item isn't equippable. Used only for the
   * "exactly one hand open" case (see `tapItem` below) — when both hands
   * are open the UI picks a specific slot itself via `equipToSlot`. */
  equip(itemEid: number): void;
  /** Equips `itemEid` into a specific hand slot (issue #47: letting the
   * player choose which hand), regardless of which slots are open. Only
   * called after the UI has confirmed `slot` is open (see `tapSlot`
   * below) — mirrors `equipItem` in ecs/systems/items.ts not checking
   * that itself. */
  equipToSlot(itemEid: number, slot: HandSlot): void;
  /** Returns `itemEid` (currently in a hand slot) to the inventory list. */
  unequip(itemEid: number): void;
}

const noopActions: InventoryActions = {
  equip: () => {},
  equipToSlot: () => {},
  unequip: () => {},
};

class InventoryStore {
  /** Every item the player currently carries (any slot), refreshed whole
   * each frame by `inventorySync` — small enough (a handful of items) that
   * replacing the array outright is simpler than diffing it. */
  carried: CarriedItemView[] = [];

  /** The inventory-list item currently awaiting a paper-doll hand-slot tap
   * (issue #47) — set only when the player taps an equippable item while
   * *both* hand slots are open, so there's no single obvious slot to
   * auto-equip into. `null` when nothing is pending. Consumed (and
   * cleared) by `tapSlot`; tapping the same item again also clears it. */
  selectedItemEid: number | null = null;

  private actions: InventoryActions = noopActions;

  constructor() {
    // `actions` holds plain functions, not state to react to — excluded so
    // mobx doesn't try to make it observable.
    makeAutoObservable<this, "actions">(this, { actions: false });
  }

  /** Called once from game.ts at startup, after the ECS world/camera exist. */
  bindActions(actions: InventoryActions): void {
    this.actions = actions;
  }

  setCarried(items: CarriedItemView[]): void {
    this.carried = items;
  }

  get inventoryItems(): CarriedItemView[] {
    return this.carried.filter((item) => item.slot === "inventory");
  }

  /** The item currently occupying `slot`, or `undefined` if it's open —
   * used by the paper doll (head/torso/legs/hand-left/hand-right). */
  itemInSlot(slot: CarriedSlot): CarriedItemView | undefined {
    return this.carried.find((item) => item.slot === slot);
  }

  equip(itemEid: number): void {
    this.actions.equip(itemEid);
  }

  unequip(itemEid: number): void {
    this.actions.unequip(itemEid);
  }

  /** Called when the inventory list is tapped (`InventoryList.tsx`). Three
   * cases (issue #47):
   *  - tapping the already-selected item again cancels the selection;
   *  - exactly one hand slot open: today's behavior, unchanged — equip
   *    there immediately, no extra tap;
   *  - both hand slots open: no single obvious slot, so mark the item
   *    selected and wait for a paper-doll tap (`tapSlot`) instead.
   * Both hands occupied: no-op, same as today (nothing here changes that —
   * `equip` above already no-ops silently in that case). */
  tapItem(itemEid: number): void {
    if (this.selectedItemEid === itemEid) {
      this.selectedItemEid = null;
      return;
    }
    const leftOpen = !this.itemInSlot("hand-left");
    const rightOpen = !this.itemInSlot("hand-right");
    if (leftOpen && rightOpen) {
      this.selectedItemEid = itemEid;
      return;
    }
    this.selectedItemEid = null;
    if (leftOpen || rightOpen) {
      this.equip(itemEid);
    }
  }

  /** Called when a paper-doll slot is tapped (`PaperDoll.tsx`). An occupied
   * slot always unequips (regardless of any pending selection — a user who
   * wants to swap hands unequips first, then equips into the now-open
   * slot). An open hand slot equips the pending selection there, if any,
   * and clears it either way once handled. An open non-hand slot, or an
   * open hand slot with nothing selected, is a no-op — same as today. */
  tapSlot(slot: CarriedSlot): void {
    const occupant = this.itemInSlot(slot);
    if (occupant) {
      this.unequip(occupant.eid);
      return;
    }
    if (this.selectedItemEid !== null && isHandSlot(slot)) {
      this.actions.equipToSlot(this.selectedItemEid, slot);
      this.selectedItemEid = null;
    }
  }
}

/** Single shared instance — there's only one inventory UI/one player,
 * exactly like `hudStore`. */
export const inventoryStore = new InventoryStore();
