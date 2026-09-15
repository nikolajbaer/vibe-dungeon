import { makeAutoObservable } from "mobx";

/**
 * The ECS-mutating half of player death/respawn (mirrors `InventoryActions`
 * in src/inventory/store.ts): the store has no reference to the bitecs
 * `world`, so game.ts builds a small actions object closing over it and
 * hands it over once at startup via `bindActions`.
 */
export interface HudActions {
  /** Resets the player's position/rotation/health to the level's spawn
   * point — called from `respawn()` below. */
  respawn(): void;
}

const noopActions: HudActions = {
  respawn: () => {},
};

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
  /** True once `healthCurrent` hits 0 (aggressive NPC archetypes can now
   * actually kill the player) — drives `DeathOverlay.tsx`. Deliberately a
   * plain derived flag set alongside `healthCurrent`/`healthMax` rather than
   * a getter, since respawning needs to clear it independently of whatever
   * `setHealth` is called with next (it's still 0 the instant `respawn()`
   * runs; the ECS write it triggers only takes effect starting next frame's
   * `setHealth` call). */
  playerDefeated = false;

  private actions: HudActions = noopActions;

  constructor() {
    // `actions` holds plain functions, not state to react to — excluded so
    // mobx doesn't try to make it observable (mirrors InventoryStore).
    makeAutoObservable<this, "actions">(this, { actions: false });
  }

  /** Called once from game.ts at startup, after the ECS world/player exist. */
  bindActions(actions: HudActions): void {
    this.actions = actions;
  }

  setHealth(current: number, max: number): void {
    this.healthCurrent = current;
    this.healthMax = max;
    if (current <= 0) this.playerDefeated = true;
  }

  /** Called from `DeathOverlay.tsx`'s respawn button. */
  respawn(): void {
    this.actions.respawn();
    this.playerDefeated = false;
  }
}

/** Single shared instance — there's only one HUD/one player. */
export const hudStore = new HudStore();
