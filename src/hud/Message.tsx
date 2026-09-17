import { hudStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Short-lived on-screen banner (`hudStore.message`/`showMessage`) — e.g.
 * "Door is locked." when interacting with a locked door without its key.
 * Same Preact + MobX pattern as `HealthBar`; renders nothing while
 * `hudStore.message` is unset.
 */
export function Message() {
  const message = useObserved(() => hudStore.message);
  if (!message) return null;

  return (
    <div class="hud-message" data-testid="hud-message">
      {message}
    </div>
  );
}
