import { TouchJoystick } from "./touchJoystick";
import { TouchLookDrag, type TapPoint } from "./touchLookDrag";

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

export type CombatGesture = "jab" | "cross" | "chop" | "block";

/** Maps a completed attack-button drag to a combat action. Ten pixels or
 * less remains a tap; beyond that the dominant axis wins. */
export function classifyCombatGesture(dx: number, dy: number): CombatGesture {
  if (Math.hypot(dx, dy) <= 10) return "jab";
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "cross" : "jab";
  return dy > 0 ? "block" : "chop";
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
  private requested = false;
  private startX = 0;
  private startY = 0;
  private gesture: CombatGesture | null = null;
  private held = false;
  private holdStartedAt = 0;

  constructor(label = "JAB", modifier = "") {
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
        this.startX = touch.clientX;
        this.startY = touch.clientY;
        this.held = true;
        this.holdStartedAt = performance.now();
      },
      { passive: false },
    );
    this.el.addEventListener("touchend", (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      const dx = touch.clientX - this.startX;
      const dy = touch.clientY - this.startY;
      this.gesture = classifyCombatGesture(dx, dy);
      this.requested = true;
      this.held = false;
    }, { passive: false });
    this.el.addEventListener("touchcancel", () => { this.held = false; });
  }

  /** True once for the touch that pressed this button. */
  consumeAttackRequest(): boolean {
    if (this.requested) {
      this.requested = false;
      return true;
    }
    return false;
  }

  consumeGesture(): CombatGesture | null {
    if (!this.requested) return null;
    this.requested = false;
    const gesture = this.gesture;
    this.gesture = null;
    return gesture;
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

  /** True once for the tap that requested a melee attack. */
  consumeAttackRequest(): boolean {
    return this.attackButton?.consumeAttackRequest() ?? false;
  }

  consumeAttackType(): "jab" | "cross" | "chop" | null {
    const primaryGesture = this.attackButton?.consumeGesture();
    if (primaryGesture && primaryGesture !== "block") return primaryGesture;
    if (primaryGesture === "block") this.pendingGestureBlock = true;
    return null;
  }

  /** True once for the completed swipe-down gesture -- game.ts turns this
   * into a fixed-length block *pulse* (see `TOUCH_BLOCK_PULSE_SECONDS`),
   * since a completed gesture has no ongoing "held" state of its own to
   * report, unlike the keyboard's real `isDown`. */
  consumeBlockRequest(): boolean {
    if (this.pendingGestureBlock) {
      this.pendingGestureBlock = false;
      return true;
    }
    return false;
  }

  get aimHoldSeconds(): number {
    return this.attackButton?.holdSeconds ?? 0;
  }

  setAmmoLabel(label?: string): void {
    this.attackButton?.setAmmoLabel(label);
  }

  private pendingGestureBlock = false;
}
