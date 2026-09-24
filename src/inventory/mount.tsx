import { render } from "preact";
import { EquipmentBar } from "./EquipmentBar";
import { InventoryDialog } from "./InventoryDialog";

/**
 * Mounts the inventory UI into two separate overlay DOM nodes layered above
 * the three.js canvas, the same fixed-overlay-per-piece pattern
 * `src/dialogue/mount.tsx`/`src/notice/mount.tsx`/`src/container/mount.tsx`
 * use: `EquipmentBar` (always visible, low z-index, same tier as the HUD)
 * and `InventoryDialog` (the pop-up, only ever shown one at a time alongside
 * the container/notice/dialogue panels, so it shares their higher z-index —
 * see index.html). Two separate roots rather than one, because a child's
 * `z-index` can never escape the stacking context its fixed-position parent
 * establishes — nesting both under one overlay would trap the dialog behind
 * those other panels whenever it's open at the same tier they are. Call
 * once at startup, alongside `mountHud`.
 */
export function mountInventory(container: HTMLElement): void {
  const barEl = document.createElement("div");
  barEl.id = "inventory-overlay";
  container.appendChild(barEl);
  render(<EquipmentBar />, barEl);

  const dialogEl = document.createElement("div");
  dialogEl.id = "inventory-dialog-overlay";
  container.appendChild(dialogEl);
  render(<InventoryDialog />, dialogEl);
}
