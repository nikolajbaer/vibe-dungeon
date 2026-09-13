import type { CarriedSlot } from "../ecs/components";
import { inventoryStore } from "./store";
import { useObserved } from "./useObserved";

/** The five paper-doll slots, in display order. Only the two hand slots
 * currently do anything (equip/unequip, viewmodel) — head/torso/legs are
 * shown for a complete Ultima-Underworld/Minecraft-style doll but have no
 * item types that target them yet (issue #39). */
const SLOTS: ReadonlyArray<{ slot: CarriedSlot; label: string }> = [
  { slot: "head", label: "Head" },
  { slot: "torso", label: "Torso" },
  { slot: "legs", label: "Legs" },
  { slot: "hand-left", label: "L Hand" },
  { slot: "hand-right", label: "R Hand" },
];

/**
 * Paper-doll panel: five labeled slots showing the equipped item's icon (or
 * empty). Tapping an occupied slot unequips it, returning the item to the
 * inventory list below (`InventoryList.tsx`) — tap-based, not
 * drag-and-drop, since this is a phone-first UI.
 */
export function PaperDoll() {
  const carried = useObserved(() => inventoryStore.carried);

  return (
    <div class="inv-paperdoll" data-testid="inv-paperdoll">
      {SLOTS.map(({ slot, label }) => {
        const item = carried.find((c) => c.slot === slot);
        return (
          <button
            key={slot}
            type="button"
            class="inv-slot"
            data-testid={`inv-slot-${slot}`}
            disabled={!item}
            title={item ? `Unequip ${item.name}` : label}
            onClick={() => item && inventoryStore.unequip(item.eid)}
          >
            <span class="inv-slot-icon">{item?.icon ?? ""}</span>
            <span class="inv-slot-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
