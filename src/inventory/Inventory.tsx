import { PaperDoll } from "./PaperDoll";
import { InventoryList } from "./InventoryList";

/**
 * Inventory UI root: the right-side paper doll + inventory list panel,
 * mounted alongside the HUD (`src/hud/`) but as its own Preact tree/DOM
 * overlay — same pattern, separate module, see README Design Notes
 * ("Inventory pattern"). Add future inventory-adjacent UI (e.g. item
 * tooltips, a container view) as siblings here.
 */
export function Inventory() {
  return (
    <div id="inventory-root">
      <PaperDoll />
      <InventoryList />
    </div>
  );
}
