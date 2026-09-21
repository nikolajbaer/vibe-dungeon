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
/** One in-combat enemy's health, for the small tile bars `EnemyHealthBars.tsx`
 * draws across the top of the screen. */
export interface EnemyHealthEntry {
  eid: number;
  current: number;
  max: number;
}

/** One combat-capable NPC's floating on-screen state label
 * (`EnemyStateLabels.tsx`), already projected to screen-space pixel
 * coordinates by `hudSync.ts` (the store has no camera to project with
 * itself). `state` is the raw `NpcState` value, kept alongside the
 * human-readable `text` so the label component can color-code by state
 * without re-deriving it from the text. */
export interface EnemyLabelEntry {
  eid: number;
  state: number;
  text: string;
  x: number;
  y: number;
}

class HudStore {
  healthCurrent = 100;
  healthMax = 100;
  staminaCurrent = 100;
  staminaMax = 100;
  /** Every NPC currently `CHASING`/`ATTACKING` the player (see
   * `hudSync.ts`) -- rebuilt fresh every frame, same "write unconditionally,
   * MobX only re-renders on real change" approach `setHealth` already uses.
   * `EnemyHealthBars.tsx` renders one small tile per entry; `inCombat` below
   * derives from this rather than being tracked separately, so there's one
   * source of truth for "is there a live target out there" instead of two
   * that could drift apart. */
  enemyHealthBars: EnemyHealthEntry[] = [];
  /** Every combat-capable NPC's floating state label, screen-projected by
   * `hudSync.ts` -- broader than `enemyHealthBars` above (LOITERING
   * included), since the point is to show an enemy's state at a glance
   * before it's already attacking, not just once it is. */
  enemyLabels: EnemyLabelEntry[] = [];
  /** True once `healthCurrent` hits 0 (aggressive NPC archetypes can now
   * actually kill the player) — drives `DeathOverlay.tsx`. Deliberately a
   * plain derived flag set alongside `healthCurrent`/`healthMax` rather than
   * a getter, since respawning needs to clear it independently of whatever
   * `setHealth` is called with next (it's still 0 the instant `respawn()`
   * runs; the ECS write it triggers only takes effect starting next frame's
   * `setHealth` call). */
  playerDefeated = false;
  practiceActive = false;
  practicePoints = 0;
  practiceMax = 0;
  opponentPracticePoints = 0;
  opponentPracticeMax = 0;
  /** A short-lived on-screen banner (e.g. "Door is locked."), or `undefined`
   * when none is showing — drives `Message.tsx`. Plain text, not a queue: a
   * second `showMessage` while one is already up just replaces it and resets
   * its own timer, rather than stacking (there's nowhere on screen for more
   * than one at once, and nothing today fires them fast enough for that to
   * matter). */
  message: string | undefined = undefined;
  private messageToken = 0;

  private actions: HudActions = noopActions;

  constructor() {
    // `actions` holds plain functions, not state to react to — excluded so
    // mobx doesn't try to make it observable (mirrors InventoryStore).
    makeAutoObservable<this, "actions">(this, { actions: false });
  }

  /** Whether the player is currently in combat -- one or more NPCs have
   * targeted them (see `hudSync.ts`'s `CHASING`/`ATTACKING` check). A plain
   * getter over `enemyHealthBars` rather than its own tracked field, so
   * there's exactly one thing to keep in sync from the ECS side. */
  get inCombat(): boolean {
    return this.enemyHealthBars.length > 0;
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

  setStamina(current: number, max: number): void {
    this.staminaCurrent = current;
    this.staminaMax = max;
  }

  /** Replaces the whole in-combat enemy list -- called every frame from
   * `hudSync.ts` with a freshly-built array, same "write unconditionally"
   * approach as `setHealth` above. */
  setCombatState(enemies: EnemyHealthEntry[]): void {
    this.enemyHealthBars = enemies;
  }

  /** Replaces the whole floating-label list -- same "write unconditionally"
   * shape as `setCombatState` above, called every frame from `hudSync.ts`. */
  setEnemyLabels(labels: EnemyLabelEntry[]): void {
    this.enemyLabels = labels;
  }

  setPractice(active: boolean, points = 0, max = 0, opponentPoints = 0, opponentMax = 0): void {
    this.practiceActive = active;
    this.practicePoints = points;
    this.practiceMax = max;
    this.opponentPracticePoints = opponentPoints;
    this.opponentPracticeMax = opponentMax;
  }

  /** Called from `DeathOverlay.tsx`'s respawn button. */
  respawn(): void {
    this.actions.respawn();
    this.playerDefeated = false;
  }

  /** Shows `text` for `durationMs` (default 2.5s), then clears it — unless a
   * newer `showMessage` call has already replaced it first, tracked via
   * `messageToken` so an old call's delayed clear can't stomp a message that
   * replaced it in the meantime. */
  showMessage(text: string, durationMs = 2500): void {
    this.message = text;
    const token = ++this.messageToken;
    setTimeout(() => {
      if (this.messageToken === token) this.message = undefined;
    }, durationMs);
  }
}

/** Single shared instance — there's only one HUD/one player. */
export const hudStore = new HudStore();
