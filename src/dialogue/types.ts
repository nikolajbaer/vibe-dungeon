// One-file-per-tree dialogue-authoring system, mirroring the asset-authoring
// pattern in src/assets/ (see that directory's types.ts header comment):
// every dialogue tree is one file under src/dialogue/trees/, default-
// exporting a DialogueTree, auto-discovered by dialogueRegistry.ts. A docile
// NPC archetype (`NpcArchetypeDef.dialogueId` in src/assets/types.ts)
// references a tree by id; interacting with that NPC (ecs/systems/doors.ts's
// tryInteract) opens it instead of the legacy toggleNpcFollow demo behavior
// an archetype without a `dialogueId` still falls back to.

/** One line a dialogue node can offer the player. Choosing it (`store.ts`'s
 * `choose`) runs `effect` first, if set — today just `"toggleFollow"`, the
 * same follow/loiter toggle the pre-dialogue demo interact used directly
 * (see `DialogueActions` in store.ts) — then either jumps to `next` or, if
 * omitted, closes the dialogue. */
export interface DialogueChoice {
  text: string;
  next?: string;
  effect?: "toggleFollow";
}

export interface DialogueNode {
  id: string;
  line: string;
  choices: DialogueChoice[];
}

/** One full dialogue tree — everything one NPC can say. `npcName` is carried
 * on the tree itself (rather than looked up from the NPC archetype that
 * opened it) since a tree is, in principle, shareable across archetypes. */
export interface DialogueTree {
  id: string;
  npcName: string;
  startNodeId: string;
  nodes: Record<string, DialogueNode>;
}
