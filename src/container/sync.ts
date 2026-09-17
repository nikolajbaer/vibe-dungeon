import { query, type World } from "bitecs";
import { Carried, Item } from "../ecs/components";
import { ITEM_REGISTRY } from "../assets/itemRegistry";
import { containerStore, type ContainerItemView } from "./store";

/**
 * Bridges ECS state to the container MobX store (mirrors
 * `inventory/sync.ts`): while a container panel is open, reads every `Item`
 * that container currently owns into a plain view-model array and writes it
 * into `containerStore`. Run from game.ts's pipeline alongside
 * `inventorySync`. No-ops when nothing's open — a closed container has
 * nothing worth re-scanning the world for every frame.
 */
export function containerSync(world: World): void {
  if (containerStore.activeEid === null) return;
  const containerEid = containerStore.activeEid;

  const contents: ContainerItemView[] = [];
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== containerEid) continue;
    const itemType = ITEM_REGISTRY[Item.itemTypeId[eid]];
    if (!itemType) continue;
    contents.push({ eid, itemTypeId: itemType.id, name: itemType.name, icon: itemType.icon });
  }
  containerStore.setContents(contents);
}
