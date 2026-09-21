import { HealthBar } from "./HealthBar";
import { StaminaBar } from "./StaminaBar";
import { EnemyHealthBars } from "./EnemyHealthBars";
import { EnemyStateLabels } from "./EnemyStateLabels";
import { DeathOverlay } from "./DeathOverlay";
import { Message } from "./Message";
import { PracticeBar } from "./PracticeBar";

/**
 * HUD root, mounted once into its own overlay DOM node layered above the
 * three.js canvas (see mount.ts). Add future HUD elements (mana, inventory
 * count, rune/spell UI) as siblings here, each its own component under
 * `src/hud/` reading its own slice of the MobX store (`store.ts`).
 */
export function HUD() {
  return (
    <div id="hud-root">
      <EnemyHealthBars />
      <EnemyStateLabels />
      <HealthBar />
      <StaminaBar />
      <PracticeBar />
      <DeathOverlay />
      <Message />
    </div>
  );
}
