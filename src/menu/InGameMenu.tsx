import { useEffect, useState } from "preact/hooks";
import { exitGameFullscreen, isGameFullscreen, requestGameFullscreen } from "./fullscreen";

export interface InGameMenuProps {
  initialFov: number;
  initialAmbient: number;
  initialWalkSpeed: number;
  initialShowHitboxes: boolean;
  onFovChange(value: number): void;
  onAmbientChange(value: number): void;
  onWalkSpeedChange(value: number): void;
  onShowHitboxesChange(value: boolean): void;
  onRestart(): void;
  onMainMenu(): void;
}

export function InGameMenu(props: InGameMenuProps) {
  const [open, setOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(isGameFullscreen());
  const [fov, setFov] = useState(props.initialFov);
  const [ambient, setAmbient] = useState(props.initialAmbient);
  const [walkSpeed, setWalkSpeed] = useState(props.initialWalkSpeed);
  const [showHitboxes, setShowHitboxes] = useState(props.initialShowHitboxes);

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
        onClick={() => {
          setOpen(!open);
          if (open) setDebugOpen(false);
        }}
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
            data-testid="game-menu-debug"
            aria-expanded={debugOpen}
            onClick={() => setDebugOpen(!debugOpen)}
          >
            Debug settings
          </button>
          {debugOpen && (
            <div class="game-debug-panel" data-testid="game-debug-panel">
              <label class="game-debug-control">
                <span>FOV <output>{fov.toFixed(0)}°</output></span>
                <input
                  type="range"
                  min="45"
                  max="90"
                  step="1"
                  value={fov}
                  data-testid="debug-fov"
                  onInput={(event) => {
                    const value = Number(event.currentTarget.value);
                    setFov(value);
                    props.onFovChange(value);
                  }}
                />
              </label>
              <label class="game-debug-control">
                <span>Ambient <output>{ambient.toFixed(1)}</output></span>
                <input
                  type="range"
                  min="0"
                  max="12"
                  step="0.1"
                  value={ambient}
                  data-testid="debug-ambient"
                  onInput={(event) => {
                    const value = Number(event.currentTarget.value);
                    setAmbient(value);
                    props.onAmbientChange(value);
                  }}
                />
              </label>
              <label class="game-debug-control">
                <span>Walk speed <output>{walkSpeed.toFixed(1)} m/s</output></span>
                <input
                  type="range"
                  min="1"
                  max="6"
                  step="0.1"
                  value={walkSpeed}
                  data-testid="debug-walk-speed"
                  onInput={(event) => {
                    const value = Number(event.currentTarget.value);
                    setWalkSpeed(value);
                    props.onWalkSpeedChange(value);
                  }}
                />
              </label>
              <label class="game-debug-control game-debug-checkbox">
                <span>Show hitboxes</span>
                <input
                  type="checkbox"
                  checked={showHitboxes}
                  data-testid="debug-show-hitboxes"
                  onInput={(event) => {
                    const value = event.currentTarget.checked;
                    setShowHitboxes(value);
                    props.onShowHitboxesChange(value);
                  }}
                />
              </label>
            </div>
          )}
          <button
            type="button"
            class="game-menu-action"
            data-testid="game-menu-fullscreen"
            onClick={toggleFullscreen}
          >
            {fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          </button>
          <button type="button" class="game-menu-action" data-testid="game-menu-save" disabled>
            Save (coming soon)
          </button>
          <button
            type="button"
            class="game-menu-action game-menu-restart"
            data-testid="game-menu-restart"
            onClick={props.onRestart}
          >
            Restart game
          </button>
          <button type="button" class="game-menu-action" data-testid="game-menu-main" onClick={props.onMainMenu}>
            Main menu
          </button>
        </div>
      )}
    </div>
  );
}
