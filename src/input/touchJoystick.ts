// Reimplementation of a small canvas-drawn virtual joystick, in plain
// TypeScript/DOM (no React). The interaction pattern — track one touch by
// identifier, compute a direction vector from the pad center, cap it to a
// max radius, and mark "active" past an activation threshold — follows the
// approach used by MobileStick.js in the procgen-bhell reference project,
// reimplemented cleanly for this project's stack.

const ACTIVATION_LEVEL = 0.55;

/** Owns its own canvas element and touch listeners; exposes current stick
 * state as a simple getter (`x`, `y` in [-1, 1], plus `active`). */
export class TouchJoystick {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly padRadius: number;

  private touchId: number | null = null;
  private stateX = 0;
  private stateY = 0;
  private stateActive = false;

  constructor(corner: "left" | "right", size = 120, padRadius = 26) {
    this.size = size;
    this.padRadius = padRadius;

    this.el = document.createElement("div");
    this.el.className = `touch-joystick touch-joystick-${corner}`;

    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.el.appendChild(this.canvas);

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.canvas.addEventListener("touchend", this.onTouchEnd, { passive: false });
    this.canvas.addEventListener("touchcancel", this.onTouchEnd, { passive: false });

    this.draw(null, false);
  }

  /** Horizontal axis, roughly [-1, 1] (left/negative to right/positive). */
  get x(): number {
    return this.stateX;
  }

  /** Vertical axis, roughly [-1, 1] (down/negative to up/positive). */
  get y(): number {
    return this.stateY;
  }

  /** True once the touch has moved past the activation threshold from
   * center — lets callers ignore small accidental taps/drift. */
  get active(): boolean {
    return this.stateActive;
  }

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (this.touchId !== null) return;
    const touch = e.changedTouches[0];
    this.touchId = touch.identifier;
    this.update(touch);
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    if (this.touchId === null) return;
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i];
      if (touch.identifier === this.touchId) {
        this.update(touch);
        return;
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.touchId) {
        this.touchId = null;
        this.stateX = 0;
        this.stateY = 0;
        this.stateActive = false;
        this.draw(null, false);
        return;
      }
    }
  };

  private update(touch: Touch): void {
    const rect = this.canvas.getBoundingClientRect();
    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const maxRadius = this.size / 2 - this.padRadius;

    let dx = touch.clientX - rect.left - centerX;
    let dy = touch.clientY - rect.top - centerY;
    const dist = Math.hypot(dx, dy);
    const active = dist >= maxRadius * ACTIVATION_LEVEL;

    if (dist > maxRadius && dist > 0) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    this.stateX = dx / maxRadius;
    this.stateY = -dy / maxRadius; // screen-down is negative, so up is positive
    this.stateActive = active;

    this.draw({ x: centerX + dx, y: centerY + dy }, active);
  }

  private draw(padPos: { x: number; y: number } | null, active: boolean): void {
    const ctx = this.ctx;
    const w = this.size;
    const h = this.size;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - this.padRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const p = padPos ?? { x: w / 2, y: h / 2 };
    ctx.beginPath();
    ctx.arc(p.x, p.y, this.padRadius, 0, Math.PI * 2);
    ctx.fillStyle = active ? "rgba(130,190,255,0.6)" : "rgba(255,255,255,0.22)";
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.fill();
    ctx.stroke();
  }
}
