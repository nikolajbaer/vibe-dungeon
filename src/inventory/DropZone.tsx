import { inventoryStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Drop zone: a toggle button between the paper doll and the inventory list.
 * Tapping it arms `inventoryStore.dropArmed`; while armed, the *next* tap on
 * any carried item — in the inventory list (`InventoryList.tsx`) or an
 * occupied paper-doll slot (`PaperDoll.tsx`) — drops that item instead of
 * whatever it would normally do, then disarms automatically
 * (`inventoryStore.dropTapped`). Tapping this button again while armed
 * cancels it without dropping anything. This is the tap-based equivalent of
 * a drag-to-drop target: the panel is phone-first (see `PaperDoll.tsx`'s own
 * doc comment), so "select a mode, then tap a target" stays consistent with
 * every other inventory interaction rather than introducing drag gestures
 * just for this one case.
 */
export function DropZone() {
  const { dropArmed } = useObserved(() => ({ dropArmed: inventoryStore.dropArmed }));

  return (
    <button
      type="button"
      class="inv-drop-zone"
      data-testid="inv-drop-zone"
      data-armed={dropArmed}
      title={dropArmed ? "Tap an item to drop it (tap again to cancel)" : "Drop an item"}
      onClick={() => inventoryStore.toggleDropArmed()}
    >
      {dropArmed ? "Tap an item to drop" : "Drop"}
    </button>
  );
}
