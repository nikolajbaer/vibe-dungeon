import { TouchJoystick } from "./touchJoystick";
import { TouchLookDrag } from "./touchLookDrag";

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * A plain tappable circle, bottom-left — the spot the old look-joystick used
 * before issue #31 moved look to drag-anywhere, now open again. Unlike
 * `TouchJoystick` it doesn't track drag/deflection at all, just an
 * edge-triggered "was it tapped" flag (issue #48), consumed the same way
 * `TouchLookDrag.consumeTapRequest()` is. Styled to match `.touch-joystick`
 * in index.html (own `.touch-attack-btn` rule, same corner-pinned circle
 * look) rather than reusing `TouchJoystick`'s canvas-drawn pad, since it has
 * no stick position to render.
 */
class TouchAttackButton {
  readonly el: HTMLDivElement;
  private requested = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "touch-attack-btn";
    this.el.textContent = "ATK";

    this.el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        this.requested = true;
      },
      { passive: false },
    );
  }

  /** True once for the touch that pressed this button. */
  consumeAttackRequest(): boolean {
    if (this.requested) {
      this.requested = false;
      return true;
    }
    return false;
  }
}

/**
 * Sets up the move stick (bottom-right), the attack button (bottom-left,
 * issue #48), and Minecraft-style drag-to-look (anywhere else on screen),
 * but only on touch-capable devices. On desktop, `moveStick`/`lookDrag` stay
 * null and no DOM/listeners are added, so this is inert (and doesn't throw)
 * when touch APIs aren't present. Desktop mouse/keyboard input is handled
 * separately and keeps working regardless.
 */
export class TouchControls {
  readonly moveStick: TouchJoystick | null = null;
  readonly lookDrag: TouchLookDrag | null = null;
  private readonly attackButton: TouchAttackButton | null = null;

  constructor(container: HTMLElement) {
    if (!isTouchDevice()) return;

    this.moveStick = new TouchJoystick("right");
    container.appendChild(this.moveStick.el);

    this.attackButton = new TouchAttackButton();
    container.appendChild(this.attackButton.el);

    // Any touch starting outside the move stick or the attack button drives
    // look-drag; a short tap (rather than a drag) there is reported back as
    // a door-interact request via `consumeInteractRequest()` below. Tapping
    // the attack button itself is handled separately (`consumeAttackRequest`)
    // and must not also register as a look-tap/interact attempt.
    this.lookDrag = new TouchLookDrag([this.moveStick.el, this.attackButton.el]);
  }

  /** True once for the tap that requested a door interaction. */
  consumeInteractRequest(): boolean {
    return this.lookDrag?.consumeTapRequest() ?? false;
  }

  /** True once for the tap that requested a melee attack. */
  consumeAttackRequest(): boolean {
    return this.attackButton?.consumeAttackRequest() ?? false;
  }
}
