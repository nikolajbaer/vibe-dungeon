import type { DialogueTree } from "../types";

// The castle-guard archetype's dialogue tree (src/assets/npcs/
// castle-guard.ts's `dialogueId`) -- standing watch over the great hall's
// own main doors (`assets/furniture/grand-doors.ts`), which never actually
// open (see `tileTypes/castle_hall.ts`'s own doc comment). The line reflects
// that directly rather than gesturing at a lock/key the player could
// reasonably expect to find.

const castleGuardGreeting: DialogueTree = {
  id: "castle-guard-greeting",
  npcName: "Guard",
  startNodeId: "greeting",
  nodes: {
    greeting: {
      id: "greeting",
      line: "Those doors haven't opened in my time here, and they won't open in yours either. If you've business in the hall, you already know the way in.",
      choices: [{ text: "Understood." }],
    },
  },
};

export default castleGuardGreeting;
