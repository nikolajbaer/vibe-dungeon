import { inventoryStore } from "./store";
import { useObserved } from "./useObserved";
import { ItemIcon } from "./ItemIcon";

/** Same warn-when-at-cap treatment as the full dialog's own `WeightReadout`
 * — kept in sync with that component's `OVERWEIGHT_STYLE` by eye, since
 * this is the only other place carry weight renders. */
const OVERWEIGHT_STYLE = {
  color: "#ff6b6b",
};

/**
 * Always-on equipment bar, top-right of the screen: what's in each hand plus
 * the running carry-weight readout, the Minecraft/Skyrim-style compact
 * summary that replaces having the whole paper doll/inventory list on
 * screen at all times. The entire bar doubles as the "open inventory"
 * button (`InventoryDialog.tsx`) — one big mobile-friendly tap target
 * rather than a separate small icon button alongside it.
 */
export function EquipmentBar() {
  const { leftItem, rightItem, weight, maxWeight, isOverweight } = useObserved(() => ({
    leftItem: inventoryStore.itemInSlot("hand-left"),
    rightItem: inventoryStore.itemInSlot("hand-right"),
    weight: inventoryStore.weight,
    maxWeight: inventoryStore.maxWeight,
    isOverweight: inventoryStore.isOverweight,
  }));

  return (
    <button type="button" class="equip-bar" data-testid="equip-bar-open" title="Open inventory" onClick={() => inventoryStore.open()}>
      <div class="equip-bar-hands">
        <div class="equip-bar-hand" data-testid="equip-bar-hand-left">
          {leftItem ? <ItemIcon class="equip-bar-icon" itemTypeId={leftItem.itemTypeId} fallback={leftItem.icon} /> : <span class="equip-bar-hand-empty">L</span>}
        </div>
        <div class="equip-bar-hand" data-testid="equip-bar-hand-right">
          {rightItem ? <ItemIcon class="equip-bar-icon" itemTypeId={rightItem.itemTypeId} fallback={rightItem.icon} /> : <span class="equip-bar-hand-empty">R</span>}
        </div>
      </div>
      <div class="equip-bar-weight" data-testid="equip-bar-weight" style={isOverweight ? OVERWEIGHT_STYLE : undefined}>
        {weight.toFixed(1)} / {maxWeight.toFixed(1)} kg
      </div>
    </button>
  );
}
