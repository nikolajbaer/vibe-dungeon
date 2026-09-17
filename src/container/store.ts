import { makeAutoObservable } from "mobx";
import { Container } from "../ecs/components";

/** One item currently sitting inside the open container — a plain snapshot
 * written by `containerSync` each frame the panel is open, same pattern as
 * `inventory/store.ts`'s `CarriedItemView`. */
export interface ContainerItemView {
  eid: number;
  itemTypeId: string;
  name: string;
  icon: string;
  /** How many units this entity represents — `undefined` for an ordinary
   * (non-`Stackable`) item, so `!== undefined` doubles as "this is a
   * commodity, show a count and allow a partial-quantity transfer." Always
   * a positive number here: a 0-count (fully merged-away) `Stackable`
   * entity never makes it into a `contents`/`inventoryItems` list in the
   * first place (see `container/sync.ts`/`inventory/sync.ts`). */
  count?: number;
}

/**
 * The reverse-direction wiring `containerSync` (ECS -> store) never needed:
 * moving an item between the player's inventory and an open container
 * mutates `Carried.ownerEid`/`slot` (or splits/merges a `Stackable` count),
 * which this store has no reference to do itself (same "hand game.ts a
 * small actions object" pattern as `inventory/store.ts`'s
 * `InventoryActions`).
 */
export interface ContainerActions {
  /** Moves `quantity` units of `itemEid` (currently in the player's
   * inventory) into the given container — the item's entire current count
   * if omitted. Callers (`store` below) are expected to have already
   * checked the container isn't full (unless merging into a stack it
   * already holds, which doesn't need a new slot). */
  moveToContainer(itemEid: number, containerEid: number, quantity?: number): void;
  /** Moves `quantity` units of `itemEid` (currently inside a container)
   * back to the player's inventory — the item's entire current count if
   * omitted. */
  moveToPlayer(itemEid: number, quantity?: number): void;
}

const noopActions: ContainerActions = {
  moveToContainer: () => {},
  moveToPlayer: () => {},
};

/** A stackable item tapped in either column, awaiting a quantity
 * confirmation (`ContainerPanel.tsx`) before it actually moves — set only
 * when the tapped item's `count` is more than 1 (a single coin just moves
 * immediately, same as any other item, no picker needed). */
export interface PendingTransfer {
  itemEid: number;
  itemTypeId: string;
  /** Which direction confirming this transfer will move it: `"give"` is
   * player inventory -> container, `"take"` is container -> player. */
  direction: "give" | "take";
  name: string;
  icon: string;
  max: number;
  quantity: number;
}

/**
 * MobX-backed state for the container panel (a barrel, opened via
 * `ecs/systems/doors.ts`'s `tryInteract` — see `Container` in
 * ecs/components.ts). Mirrors `notice/store.ts`'s shape (an `activeEid`
 * that's `null` when closed) but, unlike reading a notice, moving items in
 * and out actually mutates ECS state, so this store also needs the
 * `dialogueStore`/`inventoryStore`-style bound actions.
 */
class ContainerStore {
  activeEid: number | null = null;
  /** Refreshed every frame the panel is open by `containerSync` — small
   * enough (a handful of items, capped by `capacity`) that replacing the
   * array outright is simpler than diffing it, same reasoning as
   * `inventory/sync.ts`. */
  contents: ContainerItemView[] = [];

  /** Heading shown in the panel — "Storage" for a barrel/backpack, or an
   * NPC's name for a corpse's loot. Set by `containerSync` (which has the
   * `world` access needed to tell them apart), defaulting to "Storage"
   * until the first sync after `open`. */
  title = "Storage";

  /** True while looting a corpse (`ecs/systems/doors.ts`'s `tryInteract`
   * opens any dead NPC's `Carried` items the same way it opens a barrel) —
   * disables the "give" side of the panel (`ContainerPanel.tsx`), since
   * looting is take-only. Set by `containerSync`. */
  isLootOnly = false;

  /** Set by `beginTransfer` when a stackable item (count > 1) is tapped —
   * `ContainerPanel.tsx` shows a quantity picker instead of moving anything
   * yet. `null` the rest of the time, including right after `confirmTransfer`/
   * `cancelTransfer`. */
  pendingTransfer: PendingTransfer | null = null;

  private actions: ContainerActions = noopActions;

  constructor() {
    makeAutoObservable<this, "actions">(this, { actions: false });
  }

  bindActions(actions: ContainerActions): void {
    this.actions = actions;
  }

  get isOpen(): boolean {
    return this.activeEid !== null;
  }

  /** `Infinity` for anything without a real `Container` component — a
   * corpse being looted, notably, which was never itself flagged as a
   * `Container` (only its *contents* are `Carried` by it) since there's no
   * sensible cap on how much loot a dead NPC can yield. */
  get capacity(): number {
    if (this.activeEid === null) return 0;
    const cap = Container.capacity[this.activeEid];
    return cap === undefined ? Infinity : cap;
  }

  get isFull(): boolean {
    return this.contents.length >= this.capacity;
  }

  /** Opens `eid`'s container — called from the interact dispatch
   * (`doors.ts`'s `tryInteract`) when a `Container` entity, or a dead NPC,
   * is hit. Callers are expected to have already checked
   * `hasComponent(world, eid, Container)` or `Dead`, same as every other
   * dispatch branch in `tryInteract`. `title`/`isLootOnly` reset to their
   * defaults here and get their real values from the next `containerSync`
   * tick, which alone has the `world` access needed to tell a corpse from
   * an ordinary container. */
  open(eid: number): void {
    this.activeEid = eid;
    this.title = "Storage";
    this.isLootOnly = false;
    this.pendingTransfer = null;
  }

  close(): void {
    this.activeEid = null;
    this.contents = [];
    this.pendingTransfer = null;
  }

  setMeta(title: string, isLootOnly: boolean): void {
    this.title = title;
    this.isLootOnly = isLootOnly;
  }

  setContents(items: ContainerItemView[]): void {
    this.contents = items;
  }

  /** Called when an inventory-list item is tapped while a container panel
   * is open (`ContainerPanel.tsx`), or confirmed via `confirmTransfer`
   * below. No-ops once full — *unless* `itemTypeId` matches a stack the
   * container already holds, since merging into an existing stack doesn't
   * need a new slot (a real barrel doesn't get any fuller for a few more
   * coins landing in the pile that's already there). `itemTypeId` is
   * omitted by the debug hooks, which just fall back to the strict
   * always-blocks-when-full check. */
  store(itemEid: number, itemTypeId?: string, quantity?: number): void {
    if (this.activeEid === null) return;
    const mergesIntoExistingStack = itemTypeId !== undefined && this.contents.some((c) => c.itemTypeId === itemTypeId);
    if (this.isFull && !mergesIntoExistingStack) return;
    this.actions.moveToContainer(itemEid, this.activeEid, quantity);
  }

  /** Called when a container-list item is tapped (`ContainerPanel.tsx`), or
   * confirmed via `confirmTransfer` below. */
  take(itemEid: number, quantity?: number): void {
    if (this.activeEid === null) return;
    this.actions.moveToPlayer(itemEid, quantity);
  }

  /** Called when a stackable item (`count` > 1) is tapped in either column
   * (`ContainerPanel.tsx`) — opens a quantity picker defaulting to the
   * item's full current count, rather than moving anything yet. A count of
   * exactly 1 skips this and moves immediately instead (see
   * `ContainerPanel.tsx`'s tap handler), so this never fires for a
   * non-stackable item or a stack already down to 1. */
  beginTransfer(itemEid: number, itemTypeId: string, direction: "give" | "take", name: string, icon: string, max: number): void {
    this.pendingTransfer = { itemEid, itemTypeId, direction, name, icon, max, quantity: max };
  }

  /** Clamped to `[1, max]` and rounded, so the stepper
   * (`ContainerPanel.tsx`) can pass a raw +/- delta without worrying about
   * overshooting either end. */
  setTransferQuantity(quantity: number): void {
    if (!this.pendingTransfer) return;
    this.pendingTransfer.quantity = Math.max(1, Math.min(this.pendingTransfer.max, Math.round(quantity)));
  }

  cancelTransfer(): void {
    this.pendingTransfer = null;
  }

  /** Commits whatever quantity is currently picked via `store`/`take`
   * above, then clears `pendingTransfer` either way — even if the move
   * itself gets refused (over weight, say), there's nothing left to
   * confirm. */
  confirmTransfer(): void {
    const pending = this.pendingTransfer;
    if (!pending) return;
    this.pendingTransfer = null;
    if (pending.direction === "give") this.store(pending.itemEid, pending.itemTypeId, pending.quantity);
    else this.take(pending.itemEid, pending.quantity);
  }
}

/** Single shared instance — there's only one container panel/one player. */
export const containerStore = new ContainerStore();
