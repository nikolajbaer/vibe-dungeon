import { makeAutoObservable } from "mobx";
import { DIALOGUE_REGISTRY } from "./dialogueRegistry";
import type { DialogueNode } from "./types";

/**
 * The ECS-mutating half of the dialogue system (mirrors `InventoryActions`
 * in src/inventory/store.ts): the store has no reference to the bitecs
 * `world`, so game.ts builds a small actions object closing over it and
 * hands it over once at startup via `bindActions`. Preact components only
 * ever call `dialogueStore.choose`, never reach into ECS themselves.
 */
export interface DialogueActions {
  /** Runs the "toggleFollow" choice effect against the NPC entity the
   * active tree was opened for — the same follow/loiter toggle a docile
   * archetype without a `dialogueId` still runs directly on interact. */
  toggleFollow(npcEid: number): void;
  startPractice(npcEid: number, agility: number): void;
}

const noopActions: DialogueActions = {
  toggleFollow: () => {},
  startPractice: () => {},
};

class DialogueStore {
  activeTreeId: string | null = null;
  currentNodeId: string | null = null;
  activeNpcEid: number | null = null;

  private actions: DialogueActions = noopActions;

  constructor() {
    // `actions` holds plain functions, not state to react to — excluded so
    // mobx doesn't try to make it observable (mirrors InventoryStore).
    makeAutoObservable<this, "actions">(this, { actions: false });
  }

  /** Called once from game.ts at startup, after the ECS world exists. */
  bindActions(actions: DialogueActions): void {
    this.actions = actions;
  }

  get isOpen(): boolean {
    return this.activeTreeId !== null;
  }

  get currentNode(): DialogueNode | undefined {
    if (this.activeTreeId === null || this.currentNodeId === null) return undefined;
    return DIALOGUE_REGISTRY[this.activeTreeId]?.nodes[this.currentNodeId];
  }

  get npcName(): string | undefined {
    return this.activeTreeId === null ? undefined : DIALOGUE_REGISTRY[this.activeTreeId]?.npcName;
  }

  /** Opens `treeId` at its start node, for `npcEid` — called from the
   * interact dispatch (doors.ts's `tryInteract`) when a docile NPC with a
   * `dialogueId` is interacted with. Silently no-ops on an unknown id. */
  open(npcEid: number, treeId: string): void {
    const tree = DIALOGUE_REGISTRY[treeId];
    if (!tree) return;
    this.activeTreeId = treeId;
    this.currentNodeId = tree.startNodeId;
    this.activeNpcEid = npcEid;
  }

  openAt(npcEid: number, treeId: string, nodeId: string): void {
    const tree = DIALOGUE_REGISTRY[treeId];
    if (!tree?.nodes[nodeId]) return;
    this.activeTreeId = treeId;
    this.currentNodeId = nodeId;
    this.activeNpcEid = npcEid;
  }

  close(): void {
    this.activeTreeId = null;
    this.currentNodeId = null;
    this.activeNpcEid = null;
  }

  /** Picks one of the current node's choices by index — `DialoguePanel.tsx`
   * only ever calls this with a valid index from the same `choices` array it
   * rendered from `currentNode`. Runs the choice's `effect`, if any, then
   * either jumps to `next` or closes the dialogue if it has none. */
  choose(index: number): void {
    const choice = this.currentNode?.choices[index];
    if (!choice) return;

    if (choice.effect === "toggleFollow" && this.activeNpcEid !== null) {
      this.actions.toggleFollow(this.activeNpcEid);
    }
    if (choice.effect === "startPractice" && this.activeNpcEid !== null) {
      this.actions.startPractice(this.activeNpcEid, choice.practiceAgility ?? .35);
    }

    if (choice.next) {
      this.currentNodeId = choice.next;
    } else {
      this.close();
    }
  }
}

/** Single shared instance — there's only one dialogue panel/one player. */
export const dialogueStore = new DialogueStore();
