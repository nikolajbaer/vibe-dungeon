import type { NpcArchetypeDef } from "../types";
import { createRangedNpcMesh } from "../../ecs/systems/rangedNpcAnimation";

const fighter: NpcArchetypeDef = {
  id: "crossbow-fighter", name: "Crossbow fighter", health: 60, behavior: "docile",
  halfExtent: .4, weaponClass: "twoHanded", maxStamina: 100,
  attackRange: 18, attackCooldown: 5, chaseSpeed: 2.5,
  createMesh: eid => createRangedNpcMesh("crossbow", eid),
};
export default fighter;
