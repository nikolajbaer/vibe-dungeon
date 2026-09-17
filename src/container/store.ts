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
}

/**
 * The reverse-direction wiring `containerSync` (ECS -> store) never needed:
 * moving an item between the player's inventory and an open container
 * mutates `Carried.ownerEid`/`slot`, which this store has no reference to
 * do itself (same "hand game.ts a small actions object" pattern as
 * `inventory/store.ts`'s `InventoryActions`).
 */
export interface ContainerActions {
  /** Moves `itemEid` (currently in the player's inventory) into the given
   * container. Callers (`store` below) are expected to have already
   * checked the container isn't full. */
  moveToContainer(itemEid: number, containerEid: number): void;
  /** Moves `itemEid` (currently inside a container) back to the player's
   * inventory. */
  moveToPlayer(itemEid: number): void;
}

const noopActions: ContainerActions = {
  moveToContainer: () => {},
  moveToPlayer: () => {},
};

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
  }

  close(): void {
    this.activeEid = null;
    this.contents = [];
  }

  setMeta(title: string, isLootOnly: boolean): void {
    this.title = title;
    this.isLootOnly = isLootOnly;
  }

  setContents(items: ContainerItemView[]): void {
    this.contents = items;
  }

  /** Called when an inventory-list item is tapped while a container panel
   * is open (`ContainerPanel.tsx`). No-ops once full, same as a real
   * barrel refusing another crate once it's packed. */
  store(itemEid: number): void {
    if (this.activeEid === null || this.isFull) return;
    this.actions.moveToContainer(itemEid, this.activeEid);
  }

  /** Called when a container-list item is tapped (`ContainerPanel.tsx`). */
  take(itemEid: number): void {
    if (this.activeEid === null) return;
    this.actions.moveToPlayer(itemEid);
  }
}

/** Single shared instance — there's only one container panel/one player. */
export const containerStore = new ContainerStore();
