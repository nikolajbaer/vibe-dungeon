import { TouchJoystick } from "./touchJoystick";
import { TouchLookDrag, type TapPoint } from "./touchLookDrag";

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * A plain tappable circle, bottom-right (issue: move controls to
 * center-left to match Minecraft mobile's convention, freeing up the
 * bottom-right for this). Unlike
 * `TouchJoystick` it doesn't track drag/deflection at all, just an
 * edge-triggered "was it tapped" flag (issue #48), consumed the same way
 * `TouchLookDrag.consumeTapRequest()` is. Styled to match `.touch-joystick`
 * in index.html (own `.touch-attack-btn` rule, same corner-pinned circle
 * look) rather than reusing `TouchJoystick`'s canvas-drawn pad, since it has
 * no stick position to render.
 */
class TouchAttackButton {
  readonly el: HTMLDivElement;
  private readonly ammoEl: HTMLSpanElement;
  /** One-shot touchstart edge -- see `consumePressStart`. */
  private pressed = false;
  /** One-shot touchend edge -- see `consumeAttackRelease`. */
  private released = false;
  private held = false;
  private holdStartedAt = 0;

  constructor(label = "ATK", modifier = "") {
    this.el = document.createElement("div");
    this.el.className = `touch-attack-btn ${modifier}`.trim();
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    this.el.appendChild(labelEl);
    this.ammoEl = document.createElement("span");
    this.ammoEl.className = "touch-attack-ammo";
    this.ammoEl.hidden = true;
    this.el.appendChild(this.ammoEl);

    this.el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        this.held = true;
        this.holdStartedAt = performance.now();
        this.pressed = true;
      },
      { passive: false },
    );
    this.el.addEventListener("touchend", (e) => {
      e.preventDefault();
      this.released = true;
      this.held = false;
    }, { passive: false });
    this.el.addEventListener("touchcancel", () => { this.held = false; });
  }

  /** True once for the touch that pressed this button -- fires ranged, or
   * begins the jab-vs-charged-swing hold, exactly like a mouse `mousedown`
   * (see game.ts's shared press/release melee state machine). */
  consumePressStart(): boolean {
    if (this.pressed) {
      this.pressed = false;
      return true;
    }
    return false;
  }

  /** True once for a release -- the touch equivalent of a mouse `mouseup`. */
  consumeAttackRelease(): boolean {
    if (this.released) {
      this.released = false;
      return true;
    }
    return false;
  }

  get holdSeconds(): number {
    return this.held ? (performance.now() - this.holdStartedAt) / 1000 : 0;
  }

  setAmmoLabel(label?: string): void {
    this.ammoEl.hidden = !label;
    this.ammoEl.textContent = label ?? "";
  }

  /** Shows or hides the button outright -- used for the off-hand instance,
   * which only makes sense to display once the player is actually
   * dual-wielding two weapons (`combat.ts`'s `isDualWielding`); hidden while
   * a mid-touch hold happened to be live also drops that hold (`held =
   * false`), the same as `touchcancel`, so a since-unequipped off-hand
   * weapon can't leave a stuck phantom charge behind. */
  setVisible(visible: boolean): void {
    this.el.style.display = visible ? "" : "none";
    if (!visible) this.held = false;
  }
}

/**
 * A dedicated block button, smaller and pinned just below-and-right of the
 * ATK circle (own `.touch-block-btn` rule in index.html). Unlike ATK's
 * press/release edges, this reports a genuine held state every frame --
 * `keyboard.isDown("KeyF")`'s real touch equivalent -- rather than the old
 * "swipe down on the attack button" gesture, which could only ever simulate
 * a fixed-length block pulse since a completed swipe has no ongoing "still
 * held" state of its own to report.
 */
class TouchBlockButton {
  readonly el: HTMLDivElement;
  private held = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "touch-block-btn";
    const labelEl = document.createElement("span");
    labelEl.textContent = "BLK";
    this.el.appendChild(labelEl);

    this.el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.held = true;
    }, { passive: false });
    this.el.addEventListener("touchend", (e) => {
      e.preventDefault();
      this.held = false;
    }, { passive: false });
    this.el.addEventListener("touchcancel", () => { this.held = false; });
  }

  get isHeld(): boolean {
    return this.held;
  }
}

/**
 * Sets up the move stick (bottom-left, matching Minecraft mobile's
 * convention), the attack button and its smaller block button (bottom-right,
 * block tucked below-and-right of ATK), and Minecraft-style drag-to-look
 * (anywhere else on screen), but only on touch-capable devices. On desktop,
 * `moveStick`/`lookDrag` stay null and no DOM/listeners are added, so this is
 * inert (and doesn't throw) when touch APIs aren't present. Desktop
 * mouse/keyboard input is handled separately and keeps working regardless.
 */
export class TouchControls {
  readonly moveStick: TouchJoystick | null = null;
  readonly lookDrag: TouchLookDrag | null = null;
  private readonly attackButton: TouchAttackButton | null = null;
  /** The off-hand's own attack button -- only shown once dual-wielding
   * actually puts a second weapon in play (`setOffhandVisible`, driven each
   * frame from game.ts by `combat.ts`'s `isDualWielding`); hidden by default
   * so it doesn't clutter the screen for the vastly more common
   * single-weapon/unarmed case. Stacked directly above the main ATK button
   * (own `.touch-attack-btn-offhand` modifier in index.html) rather than
   * mirrored to the move-stick side, so both attack buttons stay under the
   * same thumb. */
  private readonly offhandAttackButton: TouchAttackButton | null = null;
  private readonly blockButton: TouchBlockButton | null = null;

  /** `gameSurface` is the three.js renderer's own canvas — see
   * `TouchLookDrag`'s doc comment for why look-drag/tap-interact only ever
   * tracks a touch that starts directly on it. */
  constructor(container: HTMLElement, gameSurface: HTMLElement) {
    if (!isTouchDevice()) return;

    this.moveStick = new TouchJoystick("left");
    container.appendChild(this.moveStick.el);

    this.attackButton = new TouchAttackButton();
    container.appendChild(this.attackButton.el);

    this.offhandAttackButton = new TouchAttackButton("OFF", "touch-attack-btn-offhand");
    this.offhandAttackButton.setVisible(false);
    container.appendChild(this.offhandAttackButton.el);

    this.blockButton = new TouchBlockButton();
    container.appendChild(this.blockButton.el);

    this.lookDrag = new TouchLookDrag(gameSurface);
  }

  /** Where the tap that requested an interaction landed on screen (normalized
   * device coordinates), or `null` if there's no pending one — see
   * `TouchLookDrag.consumeTapRequest()`. */
  consumeInteractRequest(): TapPoint | null {
    return this.lookDrag?.consumeTapRequest() ?? null;
  }

  /** True once for the touch that pressed the ATK button -- see
   * `TouchAttackButton.consumePressStart`. */
  consumePressStart(): boolean {
    return this.attackButton?.consumePressStart() ?? false;
  }

  /** True once for a release -- see `TouchAttackButton.consumeAttackRelease`. */
  consumeAttackRelease(): boolean {
    return this.attackButton?.consumeAttackRelease() ?? false;
  }

  /** The off-hand attack button's own press/release edges -- see
   * `consumePressStart`/`consumeAttackRelease` above; only meaningful while
   * `setOffhandVisible(true)` has made the button visible, but harmless
   * (always false) otherwise since a hidden button can't be touched. */
  consumeOffhandPressStart(): boolean {
    return this.offhandAttackButton?.consumePressStart() ?? false;
  }
  consumeOffhandAttackRelease(): boolean {
    return this.offhandAttackButton?.consumeAttackRelease() ?? false;
  }

  /** Shows or hides the off-hand attack button -- called every frame from
   * game.ts with `combat.ts`'s `isDualWielding`, so it only ever appears
   * while there's actually a second weapon to attack with. */
  setOffhandVisible(visible: boolean): void {
    this.offhandAttackButton?.setVisible(visible);
  }

  /** Whether the dedicated block button is currently held down -- the touch
   * equivalent of `keyboard.isDown("KeyF")`, a real per-frame held state
   * rather than an edge-triggered gesture. */
  isBlockHeld(): boolean {
    return this.blockButton?.isHeld ?? false;
  }

  get aimHoldSeconds(): number {
    return this.attackButton?.holdSeconds ?? 0;
  }

  setAmmoLabel(label?: string): void {
    this.attackButton?.setAmmoLabel(label);
  }
}
