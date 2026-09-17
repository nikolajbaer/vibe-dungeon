import { inventoryStore } from "./store";
import { useObserved } from "./useObserved";

/** Warns the player they're at (or over, briefly, mid-transfer) capacity —
 * inline since `.inv-weight` in index.html carries the default styling. */
const OVERWEIGHT_STYLE = {
  color: "#ff6b6b",
};

/**
 * Small running weight readout above the inventory list (`InventoryList.tsx`)
 * — "3.2 / 5.0 kg", turning red at/over the flat `BASE_CARRY_WEIGHT` cap
 * (`inventoryStore.maxWeight`, ecs/systems/items.ts) — a carried backpack
 * never moves this number; it only ever gives its own separate contents
 * more room (see `ContainerPanel.tsx`'s own weight readout for that).
 * Purely informational: the actual pickup/take blocking happens in
 * ecs/systems/items.ts and game.ts's container actions, which show their
 * own "Too heavy to carry." HUD message when it fires — this just keeps the
 * budget visible before it does.
 */
export function WeightReadout() {
  const { weight, maxWeight, isOverweight } = useObserved(() => ({
    weight: inventoryStore.weight,
    maxWeight: inventoryStore.maxWeight,
    isOverweight: inventoryStore.isOverweight,
  }));

  return (
    <div class="inv-weight" data-testid="inv-weight" style={isOverweight ? OVERWEIGHT_STYLE : undefined}>
      {weight.toFixed(1)} / {maxWeight.toFixed(1)} kg
    </div>
  );
}
