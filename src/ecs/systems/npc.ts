import { hasComponent, query, type World } from "bitecs";
import { Dead, NPC, NpcState, Position, Velocity, PlayerControlled } from "../components";

const FOLLOW_SPEED = 2; // m/s — slower than the player's 3.2 so it doesn't ride the player's heels
export const FOLLOW_STOP_DISTANCE = 2; // meters — target follow distance, directly behind is fine for v1

const WANDER_SPEED = 0.5; // m/s — slow, idle-looking amble
const WANDER_RADIUS = 1.5; // meters around home
const WANDER_STOP_DISTANCE = 0.15; // meters — "close enough" to a wander target
const WANDER_PAUSE_MIN = 1.5; // seconds
const WANDER_PAUSE_MAX = 4; // seconds

function randomPause(): number {
  return WANDER_PAUSE_MIN + Math.random() * (WANDER_PAUSE_MAX - WANDER_PAUSE_MIN);
}

/**
 * Toggles one NPC entity between `FOLLOWING` and `LOITERING` — called from
 * the generalized interact dispatch (`tryInteract` in doors.ts) when the
 * interact raycast hits an entity carrying `NPC`, the same `E`/tap trigger
 * doors use.
 *
 * Stopping re-anchors the loiter wander to wherever the NPC actually
 * stopped (issue #36: "stays put... at wherever it stopped") rather than
 * snapping back to its original spawn point.
 */
export function toggleNpcFollow(eid: number): void {
  if (NPC.state[eid] === NpcState.FOLLOWING) {
    NPC.state[eid] = NpcState.LOITERING;
    NPC.homeX[eid] = Position.x[eid];
    NPC.homeZ[eid] = Position.z[eid];
    NPC.wanderTargetX[eid] = Position.x[eid];
    NPC.wanderTargetZ[eid] = Position.z[eid];
    NPC.wanderTimer[eid] = randomPause();
  } else {
    NPC.state[eid] = NpcState.FOLLOWING;
  }
}

/**
 * Drives every `NPC` entity each frame (issue #36):
 * - `FOLLOWING`: seeks toward the (single) `PlayerControlled` entity,
 *   stopping once within `FOLLOW_STOP_DISTANCE`.
 * - `LOITERING`: gently wanders within `WANDER_RADIUS` of its home point,
 *   pausing between legs — a nice-to-have over standing dead still, not
 *   pathfinding.
 *
 * Both branches only ever write `Velocity`; `movementSystem` integrates
 * `Position` from it afterwards and `collisionSystem` resolves the result
 * against walls/doors, exactly like the player — this system never touches
 * `Position` directly.
 */
export function npcSystem(world: World, dt: number): void {
  const [playerEid] = query(world, [PlayerControlled, Position]);

  for (const eid of query(world, [NPC, Position, Velocity])) {
    if (hasComponent(world, eid, Dead)) {
      // A dead NPC (issue #48) stops moving outright — zero its velocity so
      // movementSystem doesn't keep coasting the corpse on whatever it was
      // doing the instant it died — rather than just skipping the
      // follow/wander branches below.
      Velocity.x[eid] = 0;
      Velocity.z[eid] = 0;
      continue;
    }

    if (NPC.state[eid] === NpcState.FOLLOWING && playerEid !== undefined) {
      seekPlayer(eid, playerEid);
    } else {
      wander(eid, dt);
    }
  }
}

function seekPlayer(eid: number, playerEid: number): void {
  const dx = Position.x[playerEid] - Position.x[eid];
  const dz = Position.z[playerEid] - Position.z[eid];
  const dist = Math.hypot(dx, dz);

  if (dist <= FOLLOW_STOP_DISTANCE) {
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;
    return;
  }

  Velocity.x[eid] = (dx / dist) * FOLLOW_SPEED;
  Velocity.z[eid] = (dz / dist) * FOLLOW_SPEED;
}

function wander(eid: number, dt: number): void {
  const dx = NPC.wanderTargetX[eid] - Position.x[eid];
  const dz = NPC.wanderTargetZ[eid] - Position.z[eid];
  const dist = Math.hypot(dx, dz);

  if (dist <= WANDER_STOP_DISTANCE) {
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;

    NPC.wanderTimer[eid] -= dt;
    if (NPC.wanderTimer[eid] <= 0) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * WANDER_RADIUS;
      NPC.wanderTargetX[eid] = NPC.homeX[eid] + Math.cos(angle) * radius;
      NPC.wanderTargetZ[eid] = NPC.homeZ[eid] + Math.sin(angle) * radius;
      NPC.wanderTimer[eid] = randomPause();
    }
    return;
  }

  Velocity.x[eid] = (dx / dist) * WANDER_SPEED;
  Velocity.z[eid] = (dz / dist) * WANDER_SPEED;
}
