import { render } from "preact";
import { MainMenu } from "./MainMenu";

/**
 * Mounts the main menu into its own dedicated overlay DOM node — the same
 * fixed-overlay pattern `src/hud/mount.tsx` uses for the HUD — appended into
 * the same container the game/HUD/touch controls use. Call once at startup,
 * before `startGame()`, so the three.js scene/ECS world isn't created until
 * the player actually presses Play.
 *
 * `onPlay` is invoked once the menu has dismissed itself (unmounted and
 * removed from the DOM), so the caller can safely start the game right away.
 */
export function mountMainMenu(container: HTMLElement, onPlay: () => void): void {
  const el = document.createElement("div");
  el.id = "menu-overlay";
  container.appendChild(el);

  const handlePlay = () => {
    render(null, el);
    el.remove();
    onPlay();
  };

  render(<MainMenu onPlay={handlePlay} />, el);
}
