import { inventoryStore } from "./store";
import { useObserved } from "./useObserved";
import { noticeStore } from "../notice/store";

/** Highlight for the item currently awaiting a paper-doll tap (issue #47)
 * — a warm border/background distinct from the default slot styling
 * (`.inv-list-item` in index.html), added inline since that stylesheet is
 * outside `src/inventory/`. */
const SELECTED_STYLE = {
  background: "rgba(255, 200, 60, 0.35)",
  borderColor: "#ffcc44",
};

/**
 * Inventory list: every carried item with `slot: "inventory"`, as its
 * Unicode icon. Tapping an equippable item (`slot: "hand"` item types)
 * calls `inventoryStore.tapItem`, which either equips it immediately (one
 * hand open — today's behavior) or marks it selected and waits for a
 * paper-doll hand-slot tap (both hands open — see `PaperDoll.tsx`);
 * tapping a selected item again cancels the selection. Tapping a readable
 * item (a scroll — `CarriedItemView.readable`) opens the paged reader
 * (`noticeStore.open`) directly, called here rather than routed through
 * `inventoryStore` since reading never mutates ECS state the way equip/
 * unequip do — there's nothing for `game.ts` to bind an action for. Tapping
 * an item that's neither equippable nor readable (e.g. the gem) does
 * nothing but shows a visibly disabled affordance.
 */
export function InventoryList() {
  const { items, selectedItemEid } = useObserved(() => ({
    items: inventoryStore.inventoryItems,
    selectedItemEid: inventoryStore.selectedItemEid,
  }));

  return (
    <div class="inv-list" data-testid="inv-list">
      {items.length === 0 && <div class="inv-list-empty">Empty</div>}
      {items.map((item) => {
        const selected = item.eid === selectedItemEid;
        const interactive = item.equippable || item.readable;
        return (
          <button
            key={item.eid}
            type="button"
            class="inv-list-item"
            data-testid={`inv-item-${item.eid}`}
            data-item-type={item.itemTypeId}
            data-selected={selected}
            disabled={!interactive}
            title={item.readable ? `Read ${item.name}` : item.equippable ? `Equip ${item.name}` : item.name}
            style={selected ? SELECTED_STYLE : undefined}
            onClick={() => {
              if (item.readable) noticeStore.open(item.eid);
              else if (item.equippable) inventoryStore.tapItem(item.eid);
            }}
          >
            <span class="inv-list-item-icon">{item.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
