import { getSharedHumanoidRig } from "../../characters/humanoidRig";
import { createAnimatedNpcMesh } from "../../ecs/systems/npcAnimation";
import type { NpcArchetypeDef } from "../types";

// The villager (issue #36, extended for #dialogue): a docile archetype —
// loiters/wanders at home, follows the player when toggled, and now also
// opens a real conversation on interact (`dialogueId`) instead of only
// toggling follow. The dialogue tree itself offers "ask it to follow" as
// one of its choices (see `src/dialogue/trees/villager-greeting.ts`), so
// the original follow demo (issue #36) is still reachable through it rather
// than replaced outright.

const villager: NpcArchetypeDef = {
  id: "villager",
  name: "Villager",
  health: 30,
  behavior: "docile",
  halfExtent: 0.4,
  dialogueId: "villager-greeting",
  createMesh: (eid) => createAnimatedNpcMesh(getSharedHumanoidRig(), eid),
};

export default villager;
