import type { DialogueTree } from "../types";

// The villager archetype's dialogue tree (src/assets/npcs/villager.ts's
// `dialogueId`) — a short greeting with a lore branch and the "follow me"
// choice that replaces the old direct toggleNpcFollow-on-interact demo.

const villagerGreeting: DialogueTree = {
  id: "villager-greeting",
  npcName: "Villager",
  startNodeId: "greeting",
  nodes: {
    greeting: {
      id: "greeting",
      line: "Oh! You startled me. Welcome, traveler — not many come through here anymore.",
      choices: [
        { text: "What is this place?", next: "about-place" },
        { text: "Will you come with me?", effect: "toggleFollow" },
        { text: "Farewell." },
      ],
    },
    "about-place": {
      id: "about-place",
      line: "This hall has stood since long before I was born. Careful further in — I've heard things moving in the dark.",
      choices: [{ text: "Thanks for the warning.", next: "greeting" }],
    },
  },
};

export default villagerGreeting;
