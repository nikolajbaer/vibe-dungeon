import { TouchJoystick } from "./touchJoystick";
import { TouchLookDrag } from "./touchLookDrag";

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * Sets up the move stick (bottom-right) and Minecraft-style drag-to-look
 * (anywhere else on screen), but only on touch-capable devices. On desktop,
 * `moveStick`/`lookDrag` stay null and no DOM/listeners are added, so this
 * is inert (and doesn't throw) when touch APIs aren't present. Desktop
 * mouse/keyboard input is handled separately and keeps working regardless.
 */
export class TouchControls {
  readonly moveStick: TouchJoystick | null = null;
  readonly lookDrag: TouchLookDrag | null = null;

  constructor(container: HTMLElement) {
    if (!isTouchDevice()) return;

    this.moveStick = new TouchJoystick("right");
    container.appendChild(this.moveStick.el);

    // Any touch starting outside the move stick drives look-drag; a short
    // tap (rather than a drag) there is reported back as a door-interact
    // request via `consumeInteractRequest()` below.
    this.lookDrag = new TouchLookDrag(this.moveStick.el);
  }

  /** True once for the tap that requested a door interaction. */
  consumeInteractRequest(): boolean {
    return this.lookDrag?.consumeTapRequest() ?? false;
  }
}
