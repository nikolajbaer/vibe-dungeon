import type { DialogueTree } from "../types";

const guardGreeting: DialogueTree = {
  id: "guard-greeting",
  npcName: "Guard",
  startNodeId: "greeting",
  nodes: {
    greeting: {
      id: "greeting",
      line: "Weapons stay sheathed in the corridor. The training floor is through the north door.",
      choices: [{ text: "Understood." }],
    },
  },
};

export default guardGreeting;
