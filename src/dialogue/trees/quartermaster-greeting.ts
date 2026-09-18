import type { DialogueTree } from "../types";

// The quartermaster archetype's dialogue tree (src/assets/npcs/
// quartermaster.ts's `dialogueId`) -- explicitly tells the player trading
// isn't wired up yet, rather than the dialogue implying a purchase that
// silently does nothing. There's no buy/sell/trade system in this codebase
// at all (a planned future feature -- NPCs were kept generic/reusable with
// that in mind, see `NpcArchetypeDef`'s doc comment), so this is the
// low-effort, honest way to staff a "shop" room before that exists: the
// gear on display (`rooms/training-wing.ts`'s `items`) is free to pick up
// like any other world item, same as everything else in this game, and the
// quartermaster just says so instead of role-playing a transaction the
// engine can't back up.

const quartermasterGreeting: DialogueTree = {
  id: "quartermaster-greeting",
  npcName: "Quartermaster",
  startNodeId: "greeting",
  nodes: {
    greeting: {
      id: "greeting",
      line: "Looking to gear up? Take a look, but I can't sell you anything yet -- the ledger's not even set up. Whatever's out on the racks, just take it.",
      choices: [
        { text: "You don't trade?", next: "no-trade" },
        { text: "Good to know. Thanks." },
      ],
    },
    "no-trade": {
      id: "no-trade",
      line: "Not yet. Someday I'll have coin and a proper counter. For now, consider it all on loan.",
      choices: [{ text: "Fair enough.", next: "greeting" }],
    },
  },
};

export default quartermasterGreeting;
