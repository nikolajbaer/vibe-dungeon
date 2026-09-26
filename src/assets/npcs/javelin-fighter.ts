import type { NpcArchetypeDef } from "../types";
import { createRangedNpcMesh } from "../../ecs/systems/rangedNpcAnimation";

const fighter: NpcArchetypeDef = {
  id: "javelin-fighter", name: "Javelin and dagger fighter", health: 60, behavior: "docile",
  halfExtent: .4, weaponClass: "dagger", maxStamina: 100,
  attackRange: 12, attackReach: 1, attackDamage: 8, attackCooldown: 1,
  chaseSpeed: 2.5, createMesh: eid => createRangedNpcMesh("javelin", eid),
};
export default fighter;
