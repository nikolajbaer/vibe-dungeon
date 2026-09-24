import { containerStore } from "./store";
import { useObserved } from "./useObserved";
import { inventoryStore } from "../inventory/store";
import { ItemIcon } from "../inventory/ItemIcon";

/**
 * Container panel — shown whenever `containerStore` has an open container
 * (a barrel or backpack interacted with, or a dead NPC's corpse — see
 * `ecs/systems/doors.ts`'s `tryInteract`). Two lists side by side: the
 * container's own contents (left) and the player's inventory (right,
 * reusing `inventoryStore.inventoryItems` — the same list
 * `InventoryList.tsx` shows). Tapping an item on either side moves it to
 * the other; tapping the storage side no-ops once full. Looting a corpse
 * (`containerStore.isLootOnly`) disables the "give" side entirely — take
 * only, no leaving your own things on a body. A carried backpack's weight
 * shows up in the main `WeightReadout.tsx` total, not here — see
 * `carriedWeight`'s doc comment in ecs/systems/items.ts. Same "own fixed
 * overlay, own Preact tree" pattern as `NoticePanel`/`HUD` (see mount.tsx).
 *
 * Reads as the same kind of screen as `InventoryDialog.tsx` (matching panel
 * chrome — title, centered floating card, a closing button) rather than a
 * wholly separate UI, and "Back to Inventory" is the explicit link between
 * them: it's how a backpack opened from inside the main dialog
 * (`InventoryList.tsx`'s `isContainer` tap, which closes that dialog first)
 * gets back to the paper doll to equip whatever was just taken out, without
 * a detour through gameplay in between. "Close" (dismissing both screens
 * back to gameplay) stays available too — this is an added way out, not a
 * replacement for the direct one, since a barrel opened straight from the
 * world (no inventory dialog involved) should still just close outright.
 */
export function ContainerPanel() {
  const { isOpen, title, contents, capacity, isFull, isLootOnly, playerItems, pendingTransfer } = useObserved(() => ({
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
    pendingTransfer: containerStore.pendingTransfer,
  }));

  if (!isOpen) return null;

  // A stack of exactly 1 (or a non-stackable item) moves immediately, same
  // as before this feature existed -- the quantity picker only ever appears
  // for an actual choice between "some" and "all".
  const tapGive = (item: (typeof playerItems)[number]) => {
    if (item.count !== undefined && item.count > 1) {
      containerStore.beginTransfer(item.eid, item.itemTypeId, "give", item.name, item.icon, item.count);
    } else {
      containerStore.store(item.eid, item.itemTypeId);
    }
  };
  const tapTake = (item: (typeof contents)[number]) => {
    if (item.count !== undefined && item.count > 1) {
      containerStore.beginTransfer(item.eid, item.itemTypeId, "take", item.name, item.icon, item.count);
    } else {
      containerStore.take(item.eid);
    }
  };

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
                onClick={() => tapTake(item)}
              >
                <ItemIcon class="inv-list-item-icon" itemTypeId={item.itemTypeId} fallback={item.icon} />
                {item.count !== undefined && <span class="inv-list-item-count">{item.count}</span>}
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
                onClick={() => tapGive(item)}
              >
                <ItemIcon class="inv-list-item-icon" itemTypeId={item.itemTypeId} fallback={item.icon} />
                {item.count !== undefined && <span class="inv-list-item-count">{item.count}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div class="container-actions">
        <button
          type="button"
          class="container-back-btn"
          data-testid="container-back-to-inventory"
          onClick={() => {
            containerStore.close();
            inventoryStore.open();
          }}
        >
          Back to Inventory
        </button>
        <button type="button" class="container-close-btn" data-testid="container-close" onClick={() => containerStore.close()}>
          Close
        </button>
      </div>
      {pendingTransfer && (
        <div class="container-transfer-overlay" data-testid="container-transfer">
          <div class="container-transfer-header">
            <ItemIcon class="inv-list-item-icon" itemTypeId={pendingTransfer.itemTypeId} fallback={pendingTransfer.icon} />
            <span>{pendingTransfer.name}</span>
          </div>
          <div class="container-transfer-stepper">
            <button
              type="button"
              data-testid="container-transfer-dec"
              disabled={pendingTransfer.quantity <= 1}
              onClick={() => containerStore.setTransferQuantity(pendingTransfer.quantity - 1)}
            >
              −
            </button>
            <span class="container-transfer-qty" data-testid="container-transfer-qty">
              {pendingTransfer.quantity}
            </span>
            <button
              type="button"
              data-testid="container-transfer-inc"
              disabled={pendingTransfer.quantity >= pendingTransfer.max}
              onClick={() => containerStore.setTransferQuantity(pendingTransfer.quantity + 1)}
            >
              +
            </button>
            <button type="button" data-testid="container-transfer-all" onClick={() => containerStore.setTransferQuantity(pendingTransfer.max)}>
              All ({pendingTransfer.max})
            </button>
          </div>
          <div class="container-transfer-actions">
            <button type="button" data-testid="container-transfer-confirm" onClick={() => containerStore.confirmTransfer()}>
              {pendingTransfer.direction === "give" ? "Store" : "Take"}
            </button>
            <button type="button" data-testid="container-transfer-cancel" onClick={() => containerStore.cancelTransfer()}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
