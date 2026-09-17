import { HealthBar } from "./HealthBar";
import { DeathOverlay } from "./DeathOverlay";
import { Message } from "./Message";

/**
 * HUD root, mounted once into its own overlay DOM node layered above the
 * three.js canvas (see mount.ts). Add future HUD elements (mana, inventory
 * count, rune/spell UI) as siblings here, each its own component under
 * `src/hud/` reading its own slice of the MobX store (`store.ts`).
 */
export function HUD() {
  return (
    <div id="hud-root">
      <HealthBar />
      <DeathOverlay />
      <Message />
    </div>
  );
}
