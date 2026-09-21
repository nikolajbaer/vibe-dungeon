import { TouchJoystick } from "./touchJoystick";
import { TouchLookDrag, type TapPoint } from "./touchLookDrag";

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

export type CombatGesture = "attack" | "block";

/** Classifies a completed attack-button drag by its vertical component. A
 * deliberate downward swipe blocks; anything else -- a stationary tap,
 * sideways drift, an upward nudge, whatever the finger did while holding to
 * charge a swing -- resolves as a normal attack release. jab vs. the
 * charged swing is no longer a gesture-shape question at all now that there
 * are only two attack types (see combat.ts's `tryStartSwingCharge`/
 * `releaseSwingCharge`): it's decided by hold *duration*, the same
 * press/release edges driving desktop's mouse button. */
export function classifyCombatGesture(dy: number): CombatGesture {
  return dy > 20 ? "block" : "attack";
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
  /** One-shot touchend edge, only set when the release wasn't classified as
   * a block swipe -- see `consumeAttackRelease`. */
  private released = false;
  private pendingBlock = false;
  private startY = 0;
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
        const touch = e.changedTouches[0];
        this.startY = touch.clientY;
        this.held = true;
        this.holdStartedAt = performance.now();
        this.pressed = true;
      },
      { passive: false },
    );
    this.el.addEventListener("touchend", (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      const dy = touch.clientY - this.startY;
      if (classifyCombatGesture(dy) === "block") this.pendingBlock = true;
      else this.released = true;
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

  /** True once for a release that wasn't a downward block swipe -- the
   * touch equivalent of a mouse `mouseup`. */
  consumeAttackRelease(): boolean {
    if (this.released) {
      this.released = false;
      return true;
    }
    return false;
  }

  /** True once for a release classified as a downward block swipe -- game.ts
   * turns this into a fixed-length block *pulse* (see
   * `TOUCH_BLOCK_PULSE_SECONDS`), since a completed gesture has no ongoing
   * "held" state of its own to report, unlike the keyboard's real `isDown`. */
  consumeBlockRequest(): boolean {
    if (this.pendingBlock) {
      this.pendingBlock = false;
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
}

/**
 * Sets up the move stick (bottom-left, matching Minecraft mobile's
 * convention), the attack button (bottom-right), and Minecraft-style
 * drag-to-look (anywhere else on screen), but only on touch-capable
 * devices. On desktop, `moveStick`/`lookDrag` stay null and no DOM/listeners
 * are added, so this is inert (and doesn't throw) when touch APIs aren't
 * present. Desktop mouse/keyboard input is handled separately and keeps
 * working regardless.
 */
export class TouchControls {
  readonly moveStick: TouchJoystick | null = null;
  readonly lookDrag: TouchLookDrag | null = null;
  private readonly attackButton: TouchAttackButton | null = null;

  /** `gameSurface` is the three.js renderer's own canvas — see
   * `TouchLookDrag`'s doc comment for why look-drag/tap-interact only ever
   * tracks a touch that starts directly on it. */
  constructor(container: HTMLElement, gameSurface: HTMLElement) {
    if (!isTouchDevice()) return;

    this.moveStick = new TouchJoystick("left");
    container.appendChild(this.moveStick.el);

    this.attackButton = new TouchAttackButton();
    container.appendChild(this.attackButton.el);

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

  /** True once for a release that wasn't a block swipe -- see
   * `TouchAttackButton.consumeAttackRelease`. */
  consumeAttackRelease(): boolean {
    return this.attackButton?.consumeAttackRelease() ?? false;
  }

  /** True once for the completed swipe-down gesture -- game.ts turns this
   * into a fixed-length block *pulse* (see `TOUCH_BLOCK_PULSE_SECONDS`),
   * since a completed gesture has no ongoing "held" state of its own to
   * report, unlike the keyboard's real `isDown`. */
  consumeBlockRequest(): boolean {
    return this.attackButton?.consumeBlockRequest() ?? false;
  }

  get aimHoldSeconds(): number {
    return this.attackButton?.holdSeconds ?? 0;
  }

  setAmmoLabel(label?: string): void {
    this.attackButton?.setAmmoLabel(label);
  }
}
