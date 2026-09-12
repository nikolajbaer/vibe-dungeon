import { hudStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Bottom-center health bar — the first real HUD element built on the
 * Preact + MobX pattern (see README Design Notes, "HUD pattern"). Simple
 * flat-colored bar for now, matching the placeholder-grade look of
 * everything else pre-art-pass. Future HUD elements should follow this same
 * shape: a small Preact component reading an observable slice of
 * `hudStore` via `useObserved`, rather than reading ECS state directly.
 */
export function HealthBar() {
  const { current, max } = useObserved(() => ({
    current: hudStore.healthCurrent,
    max: hudStore.healthMax,
  }));
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;

  return (
    <div class="hud-health-bar" data-testid="hud-health-bar">
      <div
        class="hud-health-bar-fill"
        data-testid="hud-health-bar-fill"
        style={{ width: `${pct * 100}%` }}
      />
      <div class="hud-health-bar-label">
        {Math.round(current)} / {Math.round(max)}
      </div>
    </div>
  );
}
