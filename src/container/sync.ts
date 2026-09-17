import { hasComponent, query, type World } from "bitecs";
import { Carried, Dead, Item, NPC, Stackable } from "../ecs/components";
import { ITEM_REGISTRY } from "../assets/itemRegistry";
import { NPC_REGISTRY } from "../assets/npcRegistry";
import { carriedWeight, containerWeightCapacityOf } from "../ecs/systems/items";
import { containerStore, type ContainerItemView } from "./store";

/**
 * Bridges ECS state to the container MobX store (mirrors
 * `inventory/sync.ts`): while a container panel is open, reads every `Item`
 * that container currently owns into a plain view-model array and writes it
 * into `containerStore`, along with a heading and whether it's take-only
 * (a corpse) — the only two things `containerStore.open` can't figure out
 * itself, since it has no `world` access. Run from game.ts's pipeline
 * alongside `inventorySync`. No-ops when nothing's open — a closed
 * container has nothing worth re-scanning the world for every frame.
 */
export function containerSync(world: World): void {
  if (containerStore.activeEid === null) return;
  const containerEid = containerStore.activeEid;

  const contents: ContainerItemView[] = [];
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== containerEid) continue;
    if (hasComponent(world, eid, Stackable) && Stackable.count[eid] <= 0) continue;
    const itemType = ITEM_REGISTRY[Item.itemTypeId[eid]];
    if (!itemType) continue;
    const count = hasComponent(world, eid, Stackable) ? Stackable.count[eid] : undefined;
    contents.push({ eid, itemTypeId: itemType.id, name: itemType.name, icon: itemType.icon, count });
  }
  containerStore.setContents(contents);

  const isLootOnly = hasComponent(world, containerEid, Dead);
  const npcName = hasComponent(world, containerEid, NPC) ? NPC_REGISTRY[NPC.archetypeId[containerEid]]?.name : undefined;
  const title = isLootOnly ? `${npcName ?? "Corpse"}'s remains` : "Storage";
  containerStore.setMeta(title, isLootOnly);

  // A weight-capped container (a backpack) gets its own weight readout,
  // entirely separate from the player's own `inventoryStore.weight` --
  // `Item.itemTypeId[containerEid]` is `undefined` for anything that isn't
  // itself an `Item` (a barrel, an NPC's corpse), which `containerWeightCapacityOf`
  // already treats as "no cap" (`Infinity`).
  const weightCapacity = containerWeightCapacityOf(Item.itemTypeId[containerEid]);
  containerStore.setWeight(Number.isFinite(weightCapacity) ? carriedWeight(world, containerEid) : 0, weightCapacity);
}
