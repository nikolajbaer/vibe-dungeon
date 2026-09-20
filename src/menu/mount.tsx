import { render } from "preact";
import { MainMenu } from "./MainMenu";
import { requestGameFullscreen } from "./fullscreen";

/**
 * Mounts the main menu into its own dedicated overlay DOM node — the same
 * fixed-overlay pattern `src/hud/mount.tsx` uses for the HUD — appended into
 * the same container the game/HUD/touch controls use. Call once at startup,
 * before `startGame()`, so the three.js scene/ECS world isn't created until
 * the player actually presses Play — and again from the level viewer's
 * "← Menu" button, to come back here after leaving that mode.
 *
 * `onPlay`/`onViewTiles` are each invoked once the menu has dismissed itself
 * (unmounted and removed from the DOM), so the caller can safely start the
 * chosen mode right away.
 */
export function mountMainMenu(container: HTMLElement, onPlay: () => void, onCombatTest: () => void, onViewTiles: () => void): void {
  const el = document.createElement("div");
  el.id = "menu-overlay";
  container.appendChild(el);

  const dismiss = () => {
    render(null, el);
    el.remove();
  };
  const handlePlay = () => {
    // Keep this synchronous and first in the click handler: browsers only
    // grant fullscreen while the original user activation is still live.
    requestGameFullscreen(container);
    dismiss();
    onPlay();
  };
  const handleViewTiles = () => {
    dismiss();
    onViewTiles();
  };
  const handleCombatTest = () => {
    requestGameFullscreen(container);
    dismiss();
    onCombatTest();
  };

  render(<MainMenu onPlay={handlePlay} onCombatTest={handleCombatTest} onViewTiles={handleViewTiles} />, el);
}
