const SENSITIVITY = 0.0022;

/**
 * Desktop mouse-look via the Pointer Lock API. Browsers require a user
 * gesture to enable pointer lock, so this listens for a click on the given
 * element and requests lock at that point — the obvious "click to (re)enable
 * mouse-look" affordance the pointer-lock spec requires. Accumulated deltas
 * are read (and reset) once per frame via `consume()`.
 */
export class PointerLook {
  private yaw = 0;
  private pitch = 0;

  constructor(private readonly domElement: HTMLElement) {
    domElement.addEventListener("click", () => {
      if (document.pointerLockElement !== domElement) {
        domElement.requestPointerLock();
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== domElement) return;
      this.yaw += e.movementX * SENSITIVITY;
      this.pitch += e.movementY * SENSITIVITY;
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.domElement;
  }

  /** Returns accumulated look deltas since the last call, then resets them. */
  consume(): { yaw: number; pitch: number } {
    const delta = { yaw: this.yaw, pitch: this.pitch };
    this.yaw = 0;
    this.pitch = 0;
    return delta;
  }
}
