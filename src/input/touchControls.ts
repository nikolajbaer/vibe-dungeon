import { TouchJoystick } from "./touchJoystick";

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * Sets up the two virtual joysticks — bottom-left for look, bottom-right for
 * movement — and the "tap outside the pads to interact" gesture, but only on
 * touch-capable devices. On desktop, `moveStick`/`lookStick` stay null and no
 * DOM/listeners are added, so this is inert (and doesn't throw) when touch
 * APIs aren't present. Desktop mouse/keyboard input is handled separately
 * and keeps working regardless.
 */
export class TouchControls {
  readonly moveStick: TouchJoystick | null = null;
  readonly lookStick: TouchJoystick | null = null;
  private interactRequested = false;

  constructor(container: HTMLElement) {
    if (!isTouchDevice()) return;

    this.lookStick = new TouchJoystick("left");
    this.moveStick = new TouchJoystick("right");
    container.appendChild(this.lookStick.el);
    container.appendChild(this.moveStick.el);

    const lookStick = this.lookStick;
    const moveStick = this.moveStick;
    window.addEventListener(
      "touchstart",
      (e) => {
        const target = e.target as Node | null;
        if (target && (lookStick.el.contains(target) || moveStick.el.contains(target))) {
          return;
        }
        this.interactRequested = true;
      },
      { passive: true },
    );
  }

  /** True once for the tap that requested a door interaction. */
  consumeInteractRequest(): boolean {
    if (this.interactRequested) {
      this.interactRequested = false;
      return true;
    }
    return false;
  }
}
