/**
 * Main menu shown on load, before the game starts (issue #33). Plain Preact
 * component with props — no store needed here (unlike the HUD's MobX store)
 * since there's no reactive game state to observe, just a title and a
 * handful of buttons. Follows the HUD's mounting/overlay convention (see
 * `mount.tsx`) rather than its state pattern.
 *
 * "Play" and "View Tiles" (the level viewer, `src/viewer/levelViewer.ts`)
 * are both functional; "Edit Level" is still a real, visibly-disabled
 * placeholder for the level editor tracked in issue #14, rather than a
 * silently inert button.
 */
export function MainMenu({ onPlay, onCombatTest, onViewTiles }: { onPlay: () => void; onCombatTest: () => void; onViewTiles: () => void }) {
  return (
    <div class="menu-root" data-testid="menu-root">
      <div class="menu-panel">
        <h1 class="menu-title">Vibe Dungeon</h1>
        <div class="menu-options">
          <button
            type="button"
            class="menu-btn"
            data-testid="menu-play"
            onClick={onPlay}
          >
            Play
          </button>
          <button type="button" class="menu-btn" data-testid="menu-combat-test" onClick={onCombatTest}>
            Combat Test
          </button>
          <button
            type="button"
            class="menu-btn"
            data-testid="menu-view-tiles"
            onClick={onViewTiles}
          >
            View Tiles
          </button>
          <button
            type="button"
            class="menu-btn menu-btn-disabled"
            data-testid="menu-edit-level"
            disabled
            aria-disabled="true"
          >
            Edit Level
            <span class="menu-btn-note">(coming soon)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
