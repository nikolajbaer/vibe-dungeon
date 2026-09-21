import { hasComponent, query, type World } from "bitecs";
import { Dead, Health, NPC, NpcState, PlayerControlled, Practice, Stamina } from "../components";
import { hudStore, type EnemyHealthEntry } from "../../hud/store";

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
    if (hasComponent(world, eid, Stamina)) hudStore.setStamina(Stamina.current[eid], Stamina.max[eid]);
    const active = hasComponent(world, eid, Practice) && !!Practice.active[eid];
    const opponent = Practice.opponentEid[eid];
    hudStore.setPractice(active, Practice.points[eid], Practice.maxPoints[eid],
      opponent !== undefined && hasComponent(world, opponent, Practice) ? Practice.points[opponent] : 0,
      opponent !== undefined && hasComponent(world, opponent, Practice) ? Practice.maxPoints[opponent] : 0);
    break; // single player entity
  }

  // "In combat" (EnemyHealthBars.tsx's small top-of-screen tiles, and
  // hudStore.inCombat for anything else that wants to know) is defined as
  // "one or more NPCs have targeted the player" -- CHASING/ATTACKING is
  // exactly that (see NpcState's own doc comment): LOITERING/FOLLOWING never
  // reach here regardless of archetype. A sparring practice bout drives the
  // same states but has its own dedicated score UI (PracticeBar.tsx), so its
  // opponent is excluded here rather than showing a redundant health tile.
  const enemies: EnemyHealthEntry[] = [];
  for (const eid of query(world, [NPC, Health])) {
    if (hasComponent(world, eid, Dead)) continue;
    if (NPC.state[eid] !== NpcState.CHASING && NPC.state[eid] !== NpcState.ATTACKING) continue;
    if (hasComponent(world, eid, Practice) && Practice.active[eid]) continue;
    enemies.push({ eid, current: Health.current[eid], max: Health.max[eid] });
  }
  hudStore.setCombatState(enemies);
}
