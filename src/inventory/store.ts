import { makeAutoObservable } from "mobx";
import type { CarriedSlot } from "../ecs/components";

/** One carried item's UI-facing view — a plain snapshot written each frame
 * by `inventorySync` (mirrors `hudStore`'s `setHealth`), never read/written
 * directly by ECS code. */
export interface CarriedItemView {
  eid: number;
  itemTypeId: string;
  name: string;
  icon: string;
  equippable: boolean;
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
   * if both hands are full or the item isn't equippable. The UI doesn't
   * pick a slot itself — see `equipToOpenHandSlot` in ecs/systems/items.ts. */
  equip(itemEid: number): void;
  /** Returns `itemEid` (currently in a hand slot) to the inventory list. */
  unequip(itemEid: number): void;
}

const noopActions: InventoryActions = {
  equip: () => {},
  unequip: () => {},
};

class InventoryStore {
  /** Every item the player currently carries (any slot), refreshed whole
   * each frame by `inventorySync` — small enough (a handful of items) that
   * replacing the array outright is simpler than diffing it. */
  carried: CarriedItemView[] = [];

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
}

/** Single shared instance — there's only one inventory UI/one player,
 * exactly like `hudStore`. */
export const inventoryStore = new InventoryStore();
