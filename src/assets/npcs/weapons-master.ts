import { getWeaponsMasterHumanoidRig } from "../../characters/humanoidRig";
import { createAnimatedNpcMesh } from "../../ecs/systems/npcAnimation";
import type { NpcArchetypeDef } from "../types";

const weaponsMaster: NpcArchetypeDef = {
  id: "weapons-master",
  name: "Weapons Master",
  health: 100,
  behavior: "docile",
  halfExtent: .4,
  dialogueId: "weapons-master",
  attackRange: 1.5,
  attackDamage: 5,
  attackReach: 1.4,
  attackCooldown: .8,
  chaseSpeed: 2.6,
  leashRange: 8,
  weaponClass: "oneHanded",
  maxStamina: 150,
  createMesh: eid => createAnimatedNpcMesh(getWeaponsMasterHumanoidRig(), eid),
};

export default weaponsMaster;
