// Minecraft-style touch look: drag a finger anywhere on screen (outside the
// move stick) to turn the camera, rather than deflecting a fixed joystick.
// Mirrors `PointerLook`'s accumulate-then-`consume()` shape so
// `src/ecs/systems/input.ts` can treat mouse-look and touch-look the same
// way (see issue #31).

const SENSITIVITY = 0.00525; // radians per CSS px of drag (bumped 50% per feedback), analogous to PointerLook's SENSITIVITY
const TAP_THRESHOLD_PX = 10; // total displacement from touch-start below which a touch counts as a tap, not a drag

/**
 * Tracks a single "look" touch at a time (identified by its touch
 * identifier), only starting one for a touch that begins directly on
 * `gameSurface` (the three.js renderer's own canvas) — every other on-screen
 * control (the move stick, the attack button, and any Preact overlay:
 * inventory, dialogue panel, the death overlay's respawn button, ...) is a
 * separate DOM element layered on top via its own `pointer-events: auto`,
 * so a touch landing on one of those already reports that element as its
 * `target`, never the canvas. Checking the positive case (must be the
 * canvas) rather than maintaining a negative list of "other" elements to
 * ignore means a brand new overlay never needs to be added here to get tap
 * events routed correctly (a real bug this was: a tap on the dialogue
 * panel's own buttons used to *also* register as a world tap-to-interact,
 * since the old `ignoreElements` list only knew about the move stick/attack
 * button and nothing else).
 *
 * Also disambiguates tap vs. drag: a touch that ends without ever exceeding
 * `TAP_THRESHOLD_PX` of displacement from its start point is treated as a
 * tap (see `consumeTapRequest()`) instead of contributing any look delta.
 */
export class TouchLookDrag {
  private yaw = 0;
  private pitch = 0;

  private touchId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private movedPastThreshold = false;
  private tapRequested = false;

  constructor(private readonly gameSurface: HTMLElement) {
    window.addEventListener("touchstart", this.onTouchStart, { passive: true });
    window.addEventListener("touchmove", this.onTouchMove, { passive: true });
    window.addEventListener("touchend", this.onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", this.onTouchCancel, { passive: true });
  }

  /** Returns accumulated look deltas since the last call, then resets them. */
  consume(): { yaw: number; pitch: number } {
    const delta = { yaw: this.yaw, pitch: this.pitch };
    this.yaw = 0;
    this.pitch = 0;
    return delta;
  }

  /** True once for a touch that ended having stayed within the tap threshold. */
  consumeTapRequest(): boolean {
    if (this.tapRequested) {
      this.tapRequested = false;
      return true;
    }
    return false;
  }

  private onTouchStart = (e: TouchEvent): void => {
    if (this.touchId !== null) return; // already tracking a look touch

    const touch = e.changedTouches[0];
    if (touch.target !== this.gameSurface) return; // some other control/overlay owns this touch

    this.touchId = touch.identifier;
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.lastX = touch.clientX;
    this.lastY = touch.clientY;
    this.movedPastThreshold = false;
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (this.touchId === null) return;
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i];
      if (touch.identifier !== this.touchId) continue;

      this.yaw += (touch.clientX - this.lastX) * SENSITIVITY;
      this.pitch += (touch.clientY - this.lastY) * SENSITIVITY;
      this.lastX = touch.clientX;
      this.lastY = touch.clientY;

      if (!this.movedPastThreshold) {
        const dist = Math.hypot(touch.clientX - this.startX, touch.clientY - this.startY);
        if (dist > TAP_THRESHOLD_PX) this.movedPastThreshold = true;
      }
      return;
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.touchId) {
        if (!this.movedPastThreshold) this.tapRequested = true;
        this.touchId = null;
        return;
      }
    }
  };

  private onTouchCancel = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.touchId) {
        this.touchId = null; // cancelled, not a tap
        return;
      }
    }
  };
}
