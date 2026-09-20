import { useEffect, useState } from "preact/hooks";
import { exitGameFullscreen, isGameFullscreen, requestGameFullscreen } from "./fullscreen";

export function InGameMenu() {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(isGameFullscreen());

  useEffect(() => {
    const update = () => setFullscreen(isGameFullscreen());
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);

  const toggleFullscreen = () => {
    if (fullscreen) {
      exitGameFullscreen();
    } else {
      const game = document.getElementById("app");
      if (game) requestGameFullscreen(game);
    }
    setOpen(false);
  };

  return (
    <div class="game-menu-root">
      <button
        type="button"
        class="game-menu-toggle"
        data-testid="game-menu-toggle"
        aria-expanded={open}
        aria-controls="game-menu-panel"
        onClick={() => setOpen(!open)}
      >
        ☰ Menu
      </button>
      {open && (
        <div id="game-menu-panel" class="game-menu-panel" data-testid="game-menu-panel">
          <button type="button" class="game-menu-action" onClick={() => setOpen(false)}>
            Resume
          </button>
          <button
            type="button"
            class="game-menu-action"
            data-testid="game-menu-fullscreen"
            onClick={toggleFullscreen}
          >
            {fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          </button>
          <button
            type="button"
            class="game-menu-action game-menu-restart"
            data-testid="game-menu-restart"
            onClick={() => window.location.reload()}
          >
            Restart game
          </button>
        </div>
      )}
    </div>
  );
}
