import { hudStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Small health-bar tiles across the top of the screen, one per NPC currently
 * targeting the player (`hudSync.ts`'s `CHASING`/`ATTACKING` check, exposed
 * as `hudStore.enemyHealthBars`) -- only visible while at least one exists,
 * i.e. exactly while `hudStore.inCombat` is true. Keyed by `eid` so a tile
 * tracks the same enemy across frames rather than by array position (which
 * would shuffle as enemies enter/leave combat).
 */
export function EnemyHealthBars() {
  const enemies = useObserved(() => hudStore.enemyHealthBars);
  if (enemies.length === 0) return null;

  return (
    <div class="hud-enemy-bars" data-testid="hud-enemy-bars">
      {enemies.map((enemy) => {
        const pct = enemy.max > 0 ? Math.max(0, Math.min(1, enemy.current / enemy.max)) : 0;
        return (
          <div key={enemy.eid} class="hud-enemy-bar" data-testid="hud-enemy-bar">
            <div class="hud-enemy-bar-fill" style={{ width: `${pct * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}
