import { getBanditHumanoidRig, tintClonedMesh } from "../../characters/humanoidRig";
import { createAnimatedNpcMesh } from "../../ecs/systems/npcAnimation";
import type { NpcArchetypeDef } from "../types";

// The bandit: the first aggressive archetype — spots the player within
// `aggroRange` (a simple distance check, no line-of-sight — see
// `NpcArchetypeDef.aggroRange`'s doc comment), closes in at `chaseSpeed`,
// and attacks on a cooldown once in `attackRange`. Reuses the same shared
// humanoid rig as the villager, tinted rust-red (`tintClonedMesh`) so a
// hostile reads as visually distinct at a glance without new geometry.
//
// Health (20) is deliberately a bit lower than the old flat NPC_HEALTH (30)
// — two sword hits (15 each) still kill it, matching the existing "two
// 15-damage hits" combat balance note, but it's a slightly quicker fight
// than the docile villager would be if attacked, since a hostile encounter
// should resolve faster than idle chit-chat would take to wear down.

const bandit: NpcArchetypeDef = {
  id: "bandit",
  name: "Bandit",
  health: 20,
  behavior: "aggressive",
  halfExtent: 0.4,
  aggroRange: 6,
  attackRange: 1.5,
  attackDamage: 8,
  attackReach: 1.0,
  attackCooldown: 1.2,
  agility: 0.35,
  weaponClass: "dagger",
  chaseSpeed: 2.5,
  maxStamina: 60,
  createMesh: (eid) => {
    const mesh = createAnimatedNpcMesh(getBanditHumanoidRig(), eid);
    tintClonedMesh(mesh, 0xcc4433);
    return mesh;
  },
};

export default bandit;
