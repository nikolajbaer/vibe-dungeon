import { dialogueStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Dialogue panel: shown centered near the bottom of the screen whenever
 * `dialogueStore` has an active tree, mirroring the HUD/inventory's "own
 * fixed overlay, own Preact tree" pattern (see mount.tsx). Renders the
 * current node's line plus one button per choice; tapping a choice advances
 * the store via `dialogueStore.choose`.
 */
export function DialoguePanel() {
  const { isOpen, node, npcName } = useObserved(() => ({
    isOpen: dialogueStore.isOpen,
    node: dialogueStore.currentNode,
    npcName: dialogueStore.npcName,
  }));

  if (!isOpen || !node) return null;

  return (
    <div class="dialogue-root" data-testid="dialogue-panel">
      <div class="dialogue-speaker">{npcName}</div>
      <div class="dialogue-line">{node.line}</div>
      <div class="dialogue-choices">
        {node.choices.map((choice, i) => (
          <button
            key={i}
            type="button"
            class="dialogue-choice"
            data-testid={`dialogue-choice-${i}`}
            onClick={() => dialogueStore.choose(i)}
          >
            {choice.text}
          </button>
        ))}
      </div>
    </div>
  );
}
