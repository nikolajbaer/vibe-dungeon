import { inventoryStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Inventory list: every carried item with `slot: "inventory"`, as its
 * Unicode icon. Tapping an equippable item (`slot: "hand"` item types)
 * equips it into whichever hand slot is open (`inventoryStore.equip` picks
 * the slot — the UI never does); tapping a non-equippable item (e.g. the
 * gem) does nothing but shows a visibly disabled affordance.
 */
export function InventoryList() {
  const items = useObserved(() => inventoryStore.inventoryItems);

  return (
    <div class="inv-list" data-testid="inv-list">
      {items.length === 0 && <div class="inv-list-empty">Empty</div>}
      {items.map((item) => (
        <button
          key={item.eid}
          type="button"
          class="inv-list-item"
          data-testid={`inv-item-${item.eid}`}
          data-item-type={item.itemTypeId}
          disabled={!item.equippable}
          title={item.equippable ? `Equip ${item.name}` : item.name}
          onClick={() => item.equippable && inventoryStore.equip(item.eid)}
        >
          <span class="inv-list-item-icon">{item.icon}</span>
        </button>
      ))}
    </div>
  );
}
