import { render } from "preact";
import { Inventory } from "./Inventory";

/**
 * Mounts the inventory UI into its own overlay DOM node layered above the
 * three.js canvas, the same fixed-overlay pattern `src/hud/mount.tsx` uses
 * for the HUD (a separate node so the HUD's `pointer-events: none` overlay
 * doesn't have to account for the inventory's own interactive buttons).
 * Call once at startup, alongside `mountHud`.
 */
export function mountInventory(container: HTMLElement): void {
  const el = document.createElement("div");
  el.id = "inventory-overlay";
  container.appendChild(el);
  render(<Inventory />, el);
}
