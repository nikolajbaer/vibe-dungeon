import * as THREE from "three";
import { hasComponent, query, type World } from "bitecs";
import { Dead, Health, NPC, NpcState, PlayerControlled, Position, Practice, Stamina } from "../components";
import { NPC_REGISTRY } from "../../assets/npcRegistry";
import { hudStore, type EnemyHealthEntry, type EnemyLabelEntry } from "../../hud/store";
import { worldToScreen } from "../../render/worldToScreen";

/** How far above an NPC's feet (`Position.y`) its state label floats --
 * just clear of a humanoid's ~1.79m head (`HUMANOID_HEIGHT`, level/spawning.ts). */
const LABEL_HEIGHT_ABOVE_FEET = 2.1;

/** Player-facing text for each `NpcState` -- "Idle" reads more naturally to
 * a player than the internal "Loitering"; the other two are already plain
 * English. `FOLLOWING` never actually reaches a combat-capable NPC (see
 * `isCombatCapable` below) but is included so the lookup is total. */
const STATE_LABEL: Record<number, string> = {
  [NpcState.LOITERING]: "Idle",
  [NpcState.FOLLOWING]: "Following",
  [NpcState.CHASING]: "Chasing",
  [NpcState.ATTACKING]: "Attacking",
};

/**
 * Bridges ECS state to the MobX HUD store. bitecs has no built-in
 * reactivity, so this runs every frame as a normal system and simply writes
 * the player's current `Health` into the store; MobX observables only
 * actually trigger a re-render on real value change, so writing
 * unconditionally each frame is cheap even when nothing changed. Future HUD
 * elements should add their own read-and-write step here (or a sibling
 * sync function) rather than having components read ECS state directly.
 *
 * `camera`/`renderer` are only needed to project a combat-capable NPC's
 * position to screen space for its floating state label
 * (`EnemyStateLabels.tsx`) -- everything else here is pure ECS reads.
 */
export function hudSync(world: World, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
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
  //
  // The floating state label (EnemyStateLabels.tsx) is broader on purpose:
  // it's meant to show an enemy's current state at a glance, LOITERING
  // included, so the player can see a bandit go from idle to alert to
  // attacking rather than only ever reading "Chasing"/"Attacking" once it's
  // already too late to matter -- hence `isCombatCapable` below rather than
  // reusing the CHASING/ATTACKING check the health tiles use.
  const enemies: EnemyHealthEntry[] = [];
  const labels: EnemyLabelEntry[] = [];
  for (const eid of query(world, [NPC, Health, Position])) {
    if (hasComponent(world, eid, Dead)) continue;
    if (hasComponent(world, eid, Practice) && Practice.active[eid]) continue;

    if (NPC.state[eid] === NpcState.CHASING || NPC.state[eid] === NpcState.ATTACKING) {
      enemies.push({ eid, current: Health.current[eid], max: Health.max[eid] });
    }

    const archetype = NPC_REGISTRY[NPC.archetypeId[eid]];
    const isCombatCapable = archetype?.behavior === "aggressive" || !!NPC.provoked[eid];
    if (!isCombatCapable) continue;
    const headPoint = new THREE.Vector3(Position.x[eid], Position.y[eid] + LABEL_HEIGHT_ABOVE_FEET, Position.z[eid]);
    const { x, y, behindCamera } = worldToScreen(camera, renderer, headPoint);
    if (behindCamera) continue;
    labels.push({ eid, state: NPC.state[eid], text: STATE_LABEL[NPC.state[eid]] ?? "", x, y });
  }
  hudStore.setCombatState(enemies);
  hudStore.setEnemyLabels(labels);
}
