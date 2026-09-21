import { NpcState } from "../ecs/components";
import { hudStore } from "./store";
import { useObserved } from "./useObserved";

/** CSS class per `NpcState`, for color-coding a label by threat level at a
 * glance (idle/gray, alert/amber, attacking/red) -- not just plain text. */
const STATE_CLASS: Record<number, string> = {
  [NpcState.LOITERING]: "hud-enemy-label-idle",
  [NpcState.FOLLOWING]: "hud-enemy-label-idle",
  [NpcState.CHASING]: "hud-enemy-label-alert",
  [NpcState.ATTACKING]: "hud-enemy-label-attacking",
};

/**
 * Floating text above every combat-capable NPC in view, showing its current
 * `NpcState` (`hudSync.ts` does the screen-space projection, since the store
 * itself has no camera to project with). Unlike `EnemyHealthBars.tsx` this
 * isn't gated on `hudStore.inCombat` -- the whole point is to see an enemy
 * go from idle to alert to attacking, not just read "Attacking" once it
 * already is.
 */
export function EnemyStateLabels() {
  const labels = useObserved(() => hudStore.enemyLabels);
  if (labels.length === 0) return null;

  return (
    <>
      {labels.map((label) => (
        <div
          key={label.eid}
          class={`hud-enemy-label ${STATE_CLASS[label.state] ?? "hud-enemy-label-idle"}`}
          data-testid="hud-enemy-label"
          style={{ left: `${label.x}px`, top: `${label.y}px` }}
        >
          {label.text}
        </div>
      ))}
    </>
  );
}
