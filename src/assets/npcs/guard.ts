import { getGuardHumanoidRig } from "../../characters/humanoidRig";
import { createAnimatedNpcMesh } from "../../ecs/systems/npcAnimation";
import type { NpcArchetypeDef } from "../types";

const guard: NpcArchetypeDef = {
  id: "guard",
  name: "Guard",
  health: 45,
  behavior: "docile",
  halfExtent: .4,
  dialogueId: "guard-greeting",
  weaponClass: "oneHanded",
  maxStamina: 100,
  createMesh: eid => createAnimatedNpcMesh(getGuardHumanoidRig(), eid),
};

export default guard;
