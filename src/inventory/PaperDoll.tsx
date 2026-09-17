import type { CarriedSlot } from "../ecs/components";
import { inventoryStore } from "./store";
import { useObserved } from "./useObserved";

/** The five paper-doll slots, in display order. Only the two hand slots
 * currently do anything (equip/unequip, viewmodel, and now — issue #47 —
 * accepting a pending inventory-list selection) — head/torso/legs are
 * shown for a complete Ultima-Underworld/Minecraft-style doll but have no
 * item types that target them yet (issue #39). */
const SLOTS: ReadonlyArray<{ slot: CarriedSlot; label: string; isHand: boolean }> = [
  { slot: "head", label: "Head", isHand: false },
  { slot: "torso", label: "Torso", isHand: false },
  { slot: "legs", label: "Legs", isHand: false },
  { slot: "hand-left", label: "L Hand", isHand: true },
  { slot: "hand-right", label: "R Hand", isHand: true },
];

/** Highlight for an open hand slot that will accept a pending selection
 * (issue #47) — a dashed border hinting "tap here", inline since the
 * default `.inv-slot` styling lives in index.html, outside
 * `src/inventory/`. */
const TARGETABLE_STYLE = {
  borderStyle: "dashed",
  borderColor: "#ffcc44",
};

/**
 * Paper-doll panel: five labeled slots showing the equipped item's icon (or
 * empty). Tapping an occupied slot always unequips it, returning the item
 * to the inventory list below (`InventoryList.tsx`), regardless of any
 * pending selection. Tapping an *open* hand slot while an inventory item is
 * selected (`inventoryStore.selectedItemEid`, set by `InventoryList`'s
 * "both hands open" case) equips that item there specifically — tap-based,
 * not drag-and-drop, since this is a phone-first UI. Tapping an *occupied*
 * slot while the drop zone is armed (`inventoryStore.dropArmed`,
 * `DropZone.tsx`) drops that item instead of unequipping it.
 */
export function PaperDoll() {
  const { carried, selectedItemEid, dropArmed } = useObserved(() => ({
    carried: inventoryStore.carried,
    selectedItemEid: inventoryStore.selectedItemEid,
    dropArmed: inventoryStore.dropArmed,
  }));

  return (
    <div class="inv-paperdoll" data-testid="inv-paperdoll">
      {SLOTS.map(({ slot, label, isHand }) => {
        const item = carried.find((c) => c.slot === slot);
        const targetable = !item && isHand && selectedItemEid !== null;
        return (
          <button
            key={slot}
            type="button"
            class="inv-slot"
            data-testid={`inv-slot-${slot}`}
            disabled={!item && !targetable}
            title={item ? (dropArmed ? `Drop ${item.name}` : `Unequip ${item.name}`) : label}
            style={targetable ? TARGETABLE_STYLE : undefined}
            onClick={() => {
              if (dropArmed && item) inventoryStore.dropTapped(item.eid);
              else inventoryStore.tapSlot(slot);
            }}
          >
            <span class="inv-slot-icon">{item?.icon ?? ""}</span>
            <span class="inv-slot-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
