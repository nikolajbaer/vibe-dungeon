import { render } from "preact";
import { NoticePanel } from "./NoticePanel";

/**
 * Mounts the notice reader panel into its own overlay DOM node layered
 * above the three.js canvas — the same fixed-overlay pattern
 * `src/dialogue/mount.tsx`/`src/hud/mount.tsx`/`src/inventory/mount.tsx`
 * use. Call once at startup, alongside those.
 */
export function mountNotice(container: HTMLElement): void {
  const el = document.createElement("div");
  el.id = "notice-overlay";
  container.appendChild(el);
  render(<NoticePanel />, el);
}
