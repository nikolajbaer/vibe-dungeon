import type { DialogueTree } from "../types";

const weaponsMaster: DialogueTree = {
  id: "weapons-master",
  npcName: "Weapons Master",
  startNodeId: "greeting",
  nodes: {
    greeting: {
      id: "greeting",
      line: "Bring me the wooden sword from the rack and we'll spar. How hard should I make you work?",
      choices: [
        { text: "Fundamentals — take it easy.", effect: "startPractice", practiceAgility: .15 },
        { text: "A proper bout.", effect: "startPractice", practiceAgility: .35 },
        { text: "Don't hold back.", effect: "startPractice", practiceAgility: .65 },
        { text: "Not yet." },
      ],
    },
    "player-close": {
      id: "player-close",
      line: "Well fought. You won, but only just — keep your guard tighter after you commit.",
      choices: [{ text: "Again soon." }],
    },
    "player-decisive": {
      id: "player-decisive",
      line: "Excellent work. You won with plenty in reserve; your timing is becoming dangerous.",
      choices: [{ text: "Thank you." }],
    },
    "master-close": {
      id: "master-close",
      line: "I took it by a hair. You made me earn every point — one cleaner parry would have changed it.",
      choices: [{ text: "I'll get you next time." }],
    },
    "master-decisive": {
      id: "master-decisive",
      line: "I had too much left when you fell. Slow down, read the opening, then choose the strike.",
      choices: [{ text: "I'll practice." }],
    },
  },
};

export default weaponsMaster;
