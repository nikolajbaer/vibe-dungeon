import { render } from "preact";
import { ContainerPanel } from "./ContainerPanel";

/**
 * Mounts the container panel into its own overlay DOM node layered above
 * the three.js canvas — the same fixed-overlay pattern
 * `src/notice/mount.tsx`/`src/dialogue/mount.tsx`/`src/hud/mount.tsx`/
 * `src/inventory/mount.tsx` use. Call once at startup, alongside those.
 */
export function mountContainer(container: HTMLElement): void {
  const el = document.createElement("div");
  el.id = "container-overlay";
  container.appendChild(el);
  render(<ContainerPanel />, el);
}
