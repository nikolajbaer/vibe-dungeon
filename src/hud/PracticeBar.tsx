import { hudStore } from "./store";
import { useObserved } from "./useObserved";

export function PracticeBar() {
  const state = useObserved(() => ({
    active: hudStore.practiceActive,
    player: hudStore.practicePoints,
    playerMax: hudStore.practiceMax,
    opponent: hudStore.opponentPracticePoints,
    opponentMax: hudStore.opponentPracticeMax,
  }));
  if (!state.active) return null;
  return (
    <div class="practice-score" data-testid="practice-score">
      <span>You: {Math.round(state.player)} / {Math.round(state.playerMax)}</span>
      <strong>SPARRING</strong>
      <span>Master: {Math.round(state.opponent)} / {Math.round(state.opponentMax)}</span>
    </div>
  );
}
