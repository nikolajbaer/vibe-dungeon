import { makeAutoObservable } from "mobx";

/**
 * MobX-backed state for the HUD. This is the single store all HUD
 * components read from — future HUD elements (mana, inventory count,
 * rune/spell UI) should add their own observable slice here (or a sibling
 * store following the same shape) rather than reading ECS state directly.
 *
 * Uses the function-based `makeAutoObservable` API rather than decorators:
 * `experimentalDecorators` fights Vite's esbuild-based TS transform, so the
 * functional API avoids that entirely. See README Design Notes ("HUD").
 */
class HudStore {
  healthCurrent = 100;
  healthMax = 100;

  constructor() {
    makeAutoObservable(this);
  }

  setHealth(current: number, max: number): void {
    this.healthCurrent = current;
    this.healthMax = max;
  }
}

/** Single shared instance — there's only one HUD/one player. */
export const hudStore = new HudStore();
