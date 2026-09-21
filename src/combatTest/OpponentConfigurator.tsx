import { useEffect, useState } from "preact/hooks";

export type OpponentStyle = "aggressive" | "defensive" | "passive";
export type OpponentWeapon = "unarmed" | "dagger" | "sword" | "wooden_sword";

export interface OpponentConfig {
  health: number;
  speed: number;
  weapon: OpponentWeapon;
  style: OpponentStyle;
  /** How many identical copies of this opponent to spawn -- laid out in a
   * row, spaced so they never start overlapping (see bootstrap.ts's
   * `spawnOpponent`). */
  count: number;
  /** Which side this whole batch fights on (`NPC.team`, components.ts) --
   * spawning a team replaces that team's own previous batch, but leaves
   * every other team's opponents alone, so picking a second team here (with
   * a separate Spawn) lets two batches fight *each other* instead of only
   * ever the player. */
  team: number;
}

export const OPEN_OPPONENT_CONFIG_EVENT = "vibe-dungeon:open-opponent-config";

export function OpponentConfigurator({ onSpawn, onOpenChange }: { onSpawn(config: OpponentConfig): void; onOpenChange(open: boolean): void }) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState(60);
  const [speed, setSpeed] = useState(2.5);
  const [weapon, setWeapon] = useState<OpponentWeapon>("sword");
  const [style, setStyle] = useState<OpponentStyle>("aggressive");
  const [count, setCount] = useState(1);
  const [team, setTeam] = useState(1);

  useEffect(() => {
    const show = () => {
      setOpen(true);
      onOpenChange(true);
    };
    window.addEventListener(OPEN_OPPONENT_CONFIG_EVENT, show);
    return () => window.removeEventListener(OPEN_OPPONENT_CONFIG_EVENT, show);
  }, [onOpenChange]);

  return (
    <div class="opponent-config-root">
      {!open && (
        <button type="button" class="opponent-config-open" data-testid="opponent-config-open" onClick={() => { setOpen(true); onOpenChange(true); }}>
          Configure opponent
        </button>
      )}
      {open && (
        <div class="opponent-config-backdrop">
          <form
            class="opponent-config-panel"
            data-testid="opponent-config-panel"
            onSubmit={(event) => {
              event.preventDefault();
              onSpawn({ health, speed, weapon, style, count, team });
              setOpen(false);
              onOpenChange(false);
            }}
          >
            <h2>Configure opponent</h2>
            <label class="opponent-config-field">
              <span>Health <output>{health}</output></span>
              <input type="range" min="10" max="200" step="5" value={health} onInput={(e) => setHealth(Number(e.currentTarget.value))} />
            </label>
            <label class="opponent-config-field">
              <span>Speed <output>{speed.toFixed(1)} m/s</output></span>
              <input type="range" min="0.5" max="5" step="0.1" value={speed} onInput={(e) => setSpeed(Number(e.currentTarget.value))} />
            </label>
            <label class="opponent-config-field">
              <span>Weapon</span>
              <select value={weapon} onChange={(e) => setWeapon(e.currentTarget.value as OpponentWeapon)}>
                <option value="unarmed">Unarmed</option>
                <option value="dagger">Dagger</option>
                <option value="sword">Sword</option>
                <option value="wooden_sword">Wooden sword</option>
              </select>
            </label>
            <label class="opponent-config-field">
              <span>Style</span>
              <select value={style} onChange={(e) => setStyle(e.currentTarget.value as OpponentStyle)}>
                <option value="aggressive">Aggressive</option>
                <option value="defensive">Defensive</option>
                <option value="passive">Passive</option>
              </select>
            </label>
            <label class="opponent-config-field">
              <span>Count <output>{count}</output></span>
              <input type="range" min="1" max="4" step="1" value={count} onInput={(e) => setCount(Number(e.currentTarget.value))} />
            </label>
            <label class="opponent-config-field">
              <span>Team</span>
              <select value={team} onChange={(e) => setTeam(Number(e.currentTarget.value))}>
                <option value="1">Team 1 (vs. you)</option>
                <option value="2">Team 2 (vs. you and Team 1)</option>
                <option value="3">Team 3 (vs. everyone else)</option>
              </select>
            </label>
            <div class="opponent-config-actions">
              <button type="button" onClick={() => { setOpen(false); onOpenChange(false); }}>Cancel</button>
              <button type="submit" data-testid="opponent-config-spawn">Spawn</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
