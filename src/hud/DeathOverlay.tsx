import { hudStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Full-screen "You Died" overlay, shown once `hudStore.playerDefeated` is
 * true — aggressive NPC archetypes (bandit.ts) can now actually kill the
 * player, so something has to happen when they do rather than leaving them
 * stuck at 0 health with no way to continue. Its one button calls
 * `hudStore.respawn()`, which resets the player via the actions game.ts
 * bound at startup (mirrors the inventory pattern — this component never
 * touches ECS state directly).
 */
export function DeathOverlay() {
  const defeated = useObserved(() => hudStore.playerDefeated);
  if (!defeated) return null;

  return (
    <div class="death-overlay" data-testid="death-overlay">
      <div class="death-title">You Died</div>
      <button
        type="button"
        class="death-respawn-btn"
        data-testid="death-respawn-btn"
        onClick={() => hudStore.respawn()}
      >
        Respawn
      </button>
    </div>
  );
}
