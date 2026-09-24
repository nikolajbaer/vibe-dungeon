import type { DialogueTree } from "../types";

// The Maester archetype's dialogue tree (src/assets/npcs/maester.ts's
// `dialogueId`) -- introduces him as the king's adviser and hints at future
// work for the player without promising a quest system that doesn't exist
// yet, the same honest-about-missing-systems restraint
// quartermaster-greeting.ts's own comment explains for trading. Whatever he
// actually asks of the player is a background-story beat for a later task;
// this is deliberately just the introduction.

const maesterGreeting: DialogueTree = {
  id: "maester-greeting",
  npcName: "Maester",
  startNodeId: "greeting",
  nodes: {
    greeting: {
      id: "greeting",
      line: "Ah, a visitor. I'm the Maester -- I advise the king on matters he'd rather not think about himself. I don't have work for you yet, but I expect that will change.",
      choices: [
        { text: "What kind of work?", next: "future-work" },
        { text: "I'll leave you to it." },
      ],
    },
    "future-work": {
      id: "future-work",
      line: "Nothing I can put a name to yet. When it's time, you'll hear it from me first -- come back and see me now and then.",
      choices: [{ text: "I will.", next: "greeting" }],
    },
  },
};

export default maesterGreeting;
