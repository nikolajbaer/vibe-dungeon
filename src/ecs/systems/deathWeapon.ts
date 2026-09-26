import * as THREE from "three";
import { addComponent, addEntity, query, removeEntity, type World } from "bitecs";
import { Carried, Dead, Item, NPC, Object3DRef, PhysicsBody, PhysicsRotation } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import { buildItemWorldBody, dropCarriedItem } from "../../level/spawning";
import type { Physics } from "../../physics/world";
import { takeDeathWeapon } from "./npcAnimation";

/** Resolve an NPC's hidden rig prop into an independently simulated pickup.
 * Exactly half the time the carried weapon instead disappears. In both cases
 * it leaves the corpse's inventory so a visible drop cannot be duplicated. */
export function deathWeaponSystem(world: World, physics: Physics, scene: THREE.Scene, random = Math.random): void {
  for (const eid of query(world, [NPC, Dead])) {
    const pose = takeDeathWeapon(eid);
    if (!pose) continue;
    const carried = query(world, [Item, Carried]).find(itemEid =>
      Carried.ownerEid[itemEid] === eid && Item.itemTypeId[itemEid] === pose.itemTypeId);
    if (random() >= .5) {
      if (carried !== undefined) {
        Object3DRef[carried]?.removeFromParent();
        removeEntity(world, carried);
      }
      continue;
    }

    const { x, y, z } = pose.position;
    let itemEid: number;
    if (carried !== undefined) {
      itemEid = carried;
      dropCarriedItem(world, physics, scene, itemEid, x, y, z);
    } else {
      itemEid = addEntity(world);
      addComponent(world, itemEid, Item);
      Item.itemTypeId[itemEid] = pose.itemTypeId;
      buildItemWorldBody(world, physics, scene, itemEid, ITEM_REGISTRY[pose.itemTypeId], x, y, z);
    }

    const body = PhysicsBody[itemEid];
    body?.setRotation(pose.rotation, true);
    body?.setLinvel({ x: (random() - .5) * 2.4, y: 2.2, z: (random() - .5) * 2.4 }, true);
    body?.setAngvel({ x: (random() - .5) * 11, y: (random() - .5) * 11, z: (random() - .5) * 11 }, true);
    Object3DRef[itemEid]?.quaternion.copy(pose.rotation);
    PhysicsRotation.x[itemEid] = pose.rotation.x;
    PhysicsRotation.y[itemEid] = pose.rotation.y;
    PhysicsRotation.z[itemEid] = pose.rotation.z;
    PhysicsRotation.w[itemEid] = pose.rotation.w;
  }
}
