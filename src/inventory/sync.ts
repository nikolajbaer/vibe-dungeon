import { hasComponent, query, type World } from "bitecs";
import { Carried, Item, PlayerControlled, Readable, Container, Stackable } from "../ecs/components";
import { ITEM_REGISTRY } from "../assets/itemRegistry";
import { carriedWeight, maxCarryWeight } from "../ecs/systems/items";
import { inventoryStore, type CarriedItemView } from "./store";

/**
 * Bridges ECS state to the inventory MobX store (mirrors
 * `ecs/systems/hudSync.ts`): every frame, reads every `Item` the player
 * `Carried`s into a plain view-model array and writes it into
 * `inventoryStore`, along with the running total weight (`carriedWeight`)
 * against its cap (`maxCarryWeight` — not a flat constant, since a carried
 * backpack raises it) for the panel's readout — both from
 * ecs/systems/items.ts; the enforcement itself lives there and in game.ts,
 * not here. Run from game.ts's pipeline alongside `hudSync`. bitecs has no
 * built-in reactivity and the carried set is tiny, so replacing the whole
 * array unconditionally each frame (rather than diffing it) is simple and
 * cheap — mobx only re-renders observers when a value actually changes.
 */
export function inventorySync(world: World): void {
  const [playerEid] = query(world, [PlayerControlled]);
  if (playerEid === undefined) return;

  const carried: CarriedItemView[] = [];
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== playerEid) continue;
    if (hasComponent(world, eid, Stackable) && Stackable.count[eid] <= 0) continue;
    const itemType = ITEM_REGISTRY[Item.itemTypeId[eid]];
    if (!itemType) continue;
    carried.push({
      eid,
      itemTypeId: itemType.id,
      name: itemType.name,
      icon: itemType.icon,
      equippable: itemType.slot === "hand",
      readable: hasComponent(world, eid, Readable),
      isContainer: hasComponent(world, eid, Container),
      slot: Carried.slot[eid],
      count: hasComponent(world, eid, Stackable) ? Stackable.count[eid] : undefined,
    });
  }
  inventoryStore.setCarried(carried);
  inventoryStore.setWeight(carriedWeight(world, playerEid), maxCarryWeight(world, playerEid));
}
