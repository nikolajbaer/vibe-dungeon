import { hudStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Bottom-center stamina bar, stacked directly above `HealthBar.tsx` and
 * following the exact same shape (see that component's own doc comment) --
 * a plain flat-colored bar, just blue instead of red so the two read as
 * distinct resources at a glance.
 */
export function StaminaBar() {
  const { current, max } = useObserved(() => ({
    current: hudStore.staminaCurrent,
    max: hudStore.staminaMax,
  }));
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;

  return (
    <div class="hud-stamina-bar" data-testid="hud-stamina-bar">
      <div
        class="hud-stamina-bar-fill"
        data-testid="hud-stamina-bar-fill"
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  );
}
