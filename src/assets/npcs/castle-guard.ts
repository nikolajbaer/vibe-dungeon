import { getGuardHumanoidRig } from "../../characters/humanoidRig";
import { createAnimatedNpcMesh } from "../../ecs/systems/npcAnimation";
import type { NpcArchetypeDef } from "../types";

// A second guard archetype (great-hall wing task), for the two watching the
// castle hall's own main entrance -- same rig/stats as `guard.ts` (shares
// `getGuardHumanoidRig()`, so it genuinely looks like the same guard), kept
// as its own archetype file solely because `guard.ts`'s own dialogue
// ("Weapons stay sheathed in the corridor. The training floor is through
// the north door.") is specific to the training wing it actually stands in
// and would make no sense coming from someone posted at the castle's front
// doors instead. `NpcSpawn` has no per-placement dialogue override (see
// `NpcArchetypeDef`'s own doc comment) -- a distinct context needs a
// distinct archetype, the same reasoning `quartermaster.ts` gives for not
// just being another `villager` placement.

const castleGuard: NpcArchetypeDef = {
  id: "castle-guard",
  name: "Guard",
  health: 45,
  behavior: "docile",
  halfExtent: 0.4,
  dialogueId: "castle-guard-greeting",
  weaponClass: "oneHanded",
  maxStamina: 100,
  createMesh: eid => createAnimatedNpcMesh(getGuardHumanoidRig(), eid),
};

export default castleGuard;
