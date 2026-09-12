/** Tracks currently-held keys, plus one-shot "just pressed this frame"
 * detection for edge-triggered actions like interacting with a door. */
export class Keyboard {
  private down = new Set<string>();
  private justPressed = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (!this.down.has(e.code)) this.justPressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once for the frame in which `code` transitioned from up to down. */
  consumeJustPressed(code: string): boolean {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }
}
