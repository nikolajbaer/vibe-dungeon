import { PaperDoll } from "./PaperDoll";
import { WeightReadout } from "./WeightReadout";
import { DropZone } from "./DropZone";
import { InventoryList } from "./InventoryList";
import { inventoryStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * The full inventory pop-up — the paper doll, weight readout, drop zone and
 * item list that used to sit permanently on screen, now shown only while
 * `inventoryStore.isOpen` (opened via `EquipmentBar.tsx`'s tap target).
 * Mirrors `ContainerPanel.tsx`'s own "own fixed overlay, centered floating
 * panel, own close button" shape, so the two read as the same kind of
 * screen — see that component's own doc comment for the container/backpack
 * side of this pop-up pattern, including how it links back here.
 *
 * The paper doll/weight/drop-zone and the item list are grouped into their
 * own `.inventory-dialog-column` wrappers (mirroring `ContainerPanel.tsx`'s
 * `.container-column`) purely for landscape screens: index.html's
 * `orientation: landscape` media query turns `.inventory-dialog-columns`
 * into a side-by-side row there, since a wide-but-short viewport has the
 * width to spare for that and not the height to spare for everything
 * stacked — portrait keeps the plain top-to-bottom stack these wrappers
 * don't otherwise change anything about.
 */
export function InventoryDialog() {
  const { isOpen } = useObserved(() => ({ isOpen: inventoryStore.isOpen }));
  if (!isOpen) return null;

  return (
    <div class="inventory-dialog-root" data-testid="inventory-dialog">
      <div class="inventory-dialog-title">Inventory</div>
      <div class="inventory-dialog-columns">
        <div class="inventory-dialog-column">
          <PaperDoll />
          <WeightReadout />
          <DropZone />
        </div>
        <div class="inventory-dialog-column">
          <InventoryList />
        </div>
      </div>
      <button type="button" class="inventory-dialog-close" data-testid="inventory-dialog-close" onClick={() => inventoryStore.close()}>
        Close
      </button>
    </div>
  );
}
