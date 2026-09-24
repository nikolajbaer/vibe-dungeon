import { createHumanoidRig, tintClonedMesh, type HumanoidRig } from "../../characters/humanoidRig";
import { createAnimatedNpcMesh } from "../../ecs/systems/npcAnimation";
import type { NpcArchetypeDef } from "../types";

// The Maester (great-hall wing task): a third docile archetype, following
// villager.ts/quartermaster.ts's exact template (same behavior, same
// unarmed rig shape, no weapon). Staffs the castle's study
// (`rooms/castle-hall.ts`) — the king's adviser, set up here as a named,
// dialogue-bearing fixture for a background story this task only starts:
// see `dialogue/trees/maester-greeting.ts` for what he actually says today
// (nothing playable yet, honestly, same "don't imply a system that doesn't
// exist" restraint quartermaster-greeting.ts's own comment explains).
//
// No dedicated rig preset (unlike guard/bandit/weapons-master/quartermaster,
// each with their own `getXHumanoidRig()` in characters/humanoidRig.ts) —
// an elderly-scholar look is close enough to the shared villager rig
// (long grey hair, a dark robe-toned tunic) that a fifth cached preset isn't
// worth it yet; built directly here with `createHumanoidRig` and tinted a
// muted charcoal the same way bandit.ts tints a shared look for its own
// hostile archetype (see `tintClonedMesh`'s own doc comment), rather than
// adding a new named preset for a one-off NPC.

let maesterRig: HumanoidRig | undefined;
function getMaesterRig(): HumanoidRig {
  return (maesterRig ??= createHumanoidRig({ hair: "long", hairColor: 0xd8d4c8, tunic: 0x3a3450, trousers: 0x24202e }));
}

const maester: NpcArchetypeDef = {
  id: "maester",
  name: "Maester",
  health: 30,
  behavior: "docile",
  halfExtent: 0.4,
  dialogueId: "maester-greeting",
  createMesh: (eid) => {
    const mesh = createAnimatedNpcMesh(getMaesterRig(), eid);
    tintClonedMesh(mesh, 0xb8b4c0);
    return mesh;
  },
};

export default maester;
