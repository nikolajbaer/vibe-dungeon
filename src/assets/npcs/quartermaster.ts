import { getQuartermasterHumanoidRig } from "../../characters/humanoidRig";
import { createAnimatedNpcMesh } from "../../ecs/systems/npcAnimation";
import type { NpcArchetypeDef } from "../types";

// The quartermaster (training wing task): a second docile archetype,
// following `villager.ts`'s exact template (same behavior, same shared rig,
// no tint -- a hostile is what gets tinted, per bandit.ts's own comment,
// not a second docile flavor). Staffs the training wing's equipment room,
// with its own dialogue tree (`quartermaster-greeting`) that's explicit
// about there being no real buy/sell system yet, rather than pretending to
// be a shopkeeper and then doing nothing when "bought" -- see that tree's
// own comment for why.
//
// Kept as its own archetype file (not just another `villager` placement)
// specifically so the display name ("Quartermaster") and dialogue read as
// belonging to this room, matching this repo's existing pattern of a new
// archetype per distinct NPC "role" rather than parameterizing one shared
// archetype's name/dialogue per placement -- see `NpcArchetypeDef`'s own
// doc comment on why archetypes were kept generic/reusable to begin with.

const quartermaster: NpcArchetypeDef = {
  id: "quartermaster",
  name: "Quartermaster",
  health: 30,
  behavior: "docile",
  halfExtent: 0.4,
  dialogueId: "quartermaster-greeting",
  createMesh: (eid) => createAnimatedNpcMesh(getQuartermasterHumanoidRig(), eid),
};

export default quartermaster;
