import { render } from "preact";
import { DialoguePanel } from "./DialoguePanel";

/**
 * Mounts the dialogue panel into its own overlay DOM node layered above the
 * three.js canvas — the same fixed-overlay pattern `src/hud/mount.tsx` and
 * `src/inventory/mount.tsx` use. Call once at startup, alongside
 * `mountHud`/`mountInventory`.
 */
export function mountDialogue(container: HTMLElement): void {
  const el = document.createElement("div");
  el.id = "dialogue-overlay";
  container.appendChild(el);
  render(<DialoguePanel />, el);
}
