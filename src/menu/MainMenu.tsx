/**
 * Main menu shown on load, before the game starts (issue #33). Plain Preact
 * component with props — no store needed here (unlike the HUD's MobX store)
 * since there's no reactive game state to observe, just a title and a
 * handful of buttons. Follows the HUD's mounting/overlay convention (see
 * `mount.tsx`) rather than its state pattern.
 *
 * Only "Play" is functional for this pass; "View Tiles" and "Edit Level"
 * are real, visibly-disabled placeholders for future tasks (a tile/level
 * viewer, and the level editor tracked in issue #14) rather than silently
 * inert buttons.
 */
export function MainMenu({ onPlay }: { onPlay: () => void }) {
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
          <button
            type="button"
            class="menu-btn menu-btn-disabled"
            data-testid="menu-view-tiles"
            disabled
            aria-disabled="true"
          >
            View Tiles
            <span class="menu-btn-note">(coming soon)</span>
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
