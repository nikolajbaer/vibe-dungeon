import { render } from "preact";
import { HUD } from "./HUD";

/**
 * Mounts the HUD into a dedicated DOM node layered above the three.js
 * canvas — the same fixed-overlay pattern the touch joysticks already use
 * (see src/input/touchJoystick.ts). Call once at startup.
 */
export function mountHud(container: HTMLElement): void {
  const el = document.createElement("div");
  el.id = "hud-overlay";
  container.appendChild(el);
  render(<HUD />, el);
}
