import { containerStore } from "./store";
import { useObserved } from "./useObserved";
import { inventoryStore } from "../inventory/store";

/**
 * Container panel — shown whenever `containerStore` has an open container
 * (a barrel or backpack interacted with, or a dead NPC's corpse — see
 * `ecs/systems/doors.ts`'s `tryInteract`). Two lists side by side: the
 * container's own contents (left) and the player's inventory (right,
 * reusing `inventoryStore.inventoryItems` — the same list
 * `InventoryList.tsx` shows). Tapping an item on either side moves it to
 * the other; tapping the storage side no-ops once full. Looting a corpse
 * (`containerStore.isLootOnly`) disables the "give" side entirely — take
 * only, no leaving your own things on a body. Same "own fixed overlay, own
 * Preact tree" pattern as `NoticePanel`/`HUD` (see mount.tsx).
 */
export function ContainerPanel() {
  const { isOpen, title, contents, capacity, isFull, isLootOnly, playerItems } = useObserved(() => ({
    isOpen: containerStore.isOpen,
    title: containerStore.title,
    contents: containerStore.contents,
    capacity: containerStore.capacity,
    isFull: containerStore.isFull,
    isLootOnly: containerStore.isLootOnly,
    // Excludes container items (a backpack) -- no nesting a container
    // inside another container, which sidesteps both storing a backpack
    // inside itself and any deeper cycle a chain of backpacks could form.
    // `game.ts`'s `moveToContainer` action enforces this too; this filter
    // just keeps the button from ever appearing in the first place.
    playerItems: inventoryStore.inventoryItems.filter((item) => !item.isContainer),
  }));

  if (!isOpen) return null;

  return (
    <div class="container-root" data-testid="container-panel">
      <div class="container-title">
        {title}
        {Number.isFinite(capacity) ? ` (${contents.length} / ${capacity})` : ` (${contents.length})`}
      </div>
      <div class="container-columns">
        <div class="container-column">
          <div class="container-column-label">{isLootOnly ? "Loot" : "In storage"}</div>
          <div class="inv-list" data-testid="container-contents">
            {contents.length === 0 && <div class="inv-list-empty">Empty</div>}
            {contents.map((item) => (
              <button
                key={item.eid}
                type="button"
                class="inv-list-item"
                data-testid={`container-item-${item.eid}`}
                data-item-type={item.itemTypeId}
                title={`Take ${item.name}`}
                onClick={() => containerStore.take(item.eid)}
              >
                <span class="inv-list-item-icon">{item.icon}</span>
              </button>
            ))}
          </div>
        </div>
        <div class="container-column">
          <div class="container-column-label">Your inventory</div>
          <div class="inv-list" data-testid="container-inventory">
            {playerItems.length === 0 && <div class="inv-list-empty">Empty</div>}
            {playerItems.map((item) => (
              <button
                key={item.eid}
                type="button"
                class="inv-list-item"
                data-testid={`container-inv-item-${item.eid}`}
                data-item-type={item.itemTypeId}
                disabled={isFull || isLootOnly}
                title={isLootOnly ? "Can't leave items on a corpse" : isFull ? "Storage is full" : `Store ${item.name}`}
                onClick={() => containerStore.store(item.eid)}
              >
                <span class="inv-list-item-icon">{item.icon}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <button type="button" class="container-close-btn" data-testid="container-close" onClick={() => containerStore.close()}>
        Close
      </button>
    </div>
  );
}
