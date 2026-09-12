import { query, type World } from "bitecs";
import { Health, PlayerControlled } from "../components";
import { hudStore } from "../../hud/store";

/**
 * Bridges ECS state to the MobX HUD store. bitecs has no built-in
 * reactivity, so this runs every frame as a normal system and simply writes
 * the player's current `Health` into the store; MobX observables only
 * actually trigger a re-render on real value change, so writing
 * unconditionally each frame is cheap even when nothing changed. Future HUD
 * elements should add their own read-and-write step here (or a sibling
 * sync function) rather than having components read ECS state directly.
 */
export function hudSync(world: World): void {
  for (const eid of query(world, [Health, PlayerControlled])) {
    hudStore.setHealth(Health.current[eid], Health.max[eid]);
    break; // single player entity
  }
}
