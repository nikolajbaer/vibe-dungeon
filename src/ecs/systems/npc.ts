import { hasComponent, query, type World } from "bitecs";
import { Dead, NPC, NpcState, Position, Rotation, Stamina, Velocity, PlayerControlled, Practice } from "../components";
import { NPC_REGISTRY } from "../../assets/npcRegistry";
import type { NpcArchetypeDef } from "../../assets/types";
import { triggerAttack, triggerWeaponDraw } from "./npcAnimation";
import { ATTACK_ACTIVE_WINDOW, ATTACK_SHAPES, ATTACK_STAMINA_COST, UNARMED_REACH } from "./combat";
import { registerMeleeSwing } from "./meleeCollision";

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
 * Drives every `NPC` entity each frame (issue #36, extended for archetypes):
 * a docile archetype (no `behavior === "aggressive"` — the default, and the
 * only kind that existed before archetypes) runs the original state pair —
 * `FOLLOWING` seeks toward the (single) `PlayerControlled` entity, stopping
 * once within `FOLLOW_STOP_DISTANCE`; `LOITERING` gently wanders within
 * `WANDER_RADIUS` of its home point, pausing between legs. An aggressive
 * archetype instead runs `updateAggressive` below (`LOITERING` ->
 * `CHASING` -> `ATTACKING`, or back).
 *
 * Every branch only ever writes `Velocity`; `movementSystem` integrates
 * `Position` from it afterwards and `collisionSystem` resolves the result
 * against walls/doors, exactly like the player — this system never touches
 * `Position` directly. `updateAggressive`'s attack step queues a swing box
 * (`meleeCollision.ts`'s `registerMeleeSwing`) rather than dealing damage
 * itself; whether it actually lands is resolved later, the same as a
 * player's own attack.
 */
export function npcSystem(world: World, dt: number): void {
  const [playerEid] = query(world, [PlayerControlled, Position]);

  for (const eid of query(world, [NPC, Position, Velocity])) {
    if (hasComponent(world, eid, Dead)) {
      // A dead NPC (issue #48) stops moving outright — zero its velocity so
      // movementSystem doesn't keep coasting the corpse on whatever it was
      // doing the instant it died — rather than just skipping the
      // follow/wander/chase branches below.
      Velocity.x[eid] = 0;
      Velocity.z[eid] = 0;
      continue;
    }

    const archetype = NPC_REGISTRY[NPC.archetypeId[eid]];
    const testStyle = NPC.testStyle[eid];
    if (testStyle === "passive") {
      Velocity.x[eid] = 0;
      Velocity.z[eid] = 0;
      NPC.state[eid] = NpcState.LOITERING;
      continue;
    }
    if (testStyle === "aggressive") {
      updateAggressive(eid, playerEid, archetype, dt, true);
      continue;
    }
    if (testStyle === "defensive") {
      if (NPC.provoked[eid]) updateAggressive(eid, playerEid, archetype, dt, true);
      else {
        Velocity.x[eid] = 0;
        Velocity.z[eid] = 0;
      }
      continue;
    }
    const sparring = hasComponent(world, eid, Practice) && !!Practice.active[eid];
    if (archetype?.behavior === "aggressive" || sparring || !!NPC.provoked[eid]) {
      updateAggressive(eid, playerEid, archetype, dt, sparring);
      continue;
    }

    if (NPC.state[eid] === NpcState.FOLLOWING && playerEid !== undefined) {
      seekPlayer(eid, playerEid, FOLLOW_SPEED, FOLLOW_STOP_DISTANCE);
    } else {
      wander(eid, dt);
    }
  }
}

/** Moves `eid` toward `playerEid` at `speed`, stopping once within
 * `stopDistance` — shared by docile `FOLLOWING` and aggressive `CHASING`
 * (which just uses its own `chaseSpeed`/`attackRange` instead of
 * `FOLLOW_SPEED`/`FOLLOW_STOP_DISTANCE`). */
function seekPlayer(eid: number, playerEid: number, speed: number, stopDistance: number): void {
  const dx = Position.x[playerEid] - Position.x[eid];
  const dz = Position.z[playerEid] - Position.z[eid];
  const dist = Math.hypot(dx, dz);

  if (dist <= stopDistance) {
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;
    return;
  }

  Velocity.x[eid] = (dx / dist) * speed;
  Velocity.z[eid] = (dz / dist) * speed;
}

/** Sends `eid` back to `LOITERING`, re-anchoring its wander home to wherever
 * it actually stopped — the same re-anchoring a docile archetype's
 * `toggleNpcFollow` does when it drops out of `FOLLOWING`. */
function giveUpAndLoiter(eid: number): void {
  NPC.state[eid] = NpcState.LOITERING;
  NPC.homeX[eid] = Position.x[eid];
  NPC.homeZ[eid] = Position.z[eid];
  NPC.wanderTargetX[eid] = Position.x[eid];
  NPC.wanderTargetZ[eid] = Position.z[eid];
  NPC.wanderTimer[eid] = randomPause();
  Velocity.x[eid] = 0;
  Velocity.z[eid] = 0;
}

/**
 * Drives one aggressive-archetype NPC: `LOITERING` wanders exactly like a
 * docile archetype until the player comes within `archetype.aggroRange` (a
 * plain distance check — no line-of-sight, see that field's doc comment in
 * `assets/types.ts`), then `CHASING` closes in at `archetype.chaseSpeed`
 * until within `archetype.attackRange`, then `ATTACKING` stops and swings
 * (a real hit-detection box, `archetype.attackDamage` at `archetype.attackReach`
 * — see `meleeCollision.ts`) every `archetype.attackCooldown` seconds for as
 * long as the player stays in range (stepping back out to `CHASING` if they
 * retreat) — being in `attackRange` triggers the swing, not a guaranteed
 * hit, since the swing's own box is a separate, real geometric test. From either
 * `CHASING` or `ATTACKING`, straying more than `archetype.leashRange` from
 * home gives up and returns to `LOITERING` — see that field's doc comment
 * for why (an unleashed chase could otherwise cross the whole reachable
 * map once doors are open).
 */
function updateAggressive(eid: number, playerEid: number | undefined, archetype: NpcArchetypeDef, dt: number, sparring = false): void {
  if (playerEid === undefined) {
    wander(eid, dt);
    return;
  }

  if (NPC.state[eid] === NpcState.LOITERING) {
    const dx = Position.x[playerEid] - Position.x[eid];
    const dz = Position.z[playerEid] - Position.z[eid];
    if (sparring || Math.hypot(dx, dz) <= (archetype.aggroRange ?? 0)) {
      NPC.state[eid] = NpcState.CHASING;
      NPC.drawRemaining[eid] = .5;
      triggerWeaponDraw(eid);
    } else {
      wander(eid, dt);
    }
    return;
  }

  // CHASING or ATTACKING from here — both give up past the leash range.
  const homeDist = Math.hypot(Position.x[eid] - NPC.homeX[eid], Position.z[eid] - NPC.homeZ[eid]);
  if (!sparring && homeDist > (archetype.leashRange ?? Infinity)) {
    giveUpAndLoiter(eid);
    return;
  }

  const dx = Position.x[playerEid] - Position.x[eid];
  const dz = Position.z[playerEid] - Position.z[eid];
  const distToPlayer = Math.hypot(dx, dz);
  const attackRange = archetype.attackRange ?? (NPC.provoked[eid] ? 1.5 : 0);

  if (NPC.drawRemaining[eid] > 0) {
    if (triggerWeaponDraw(eid)) NPC.drawRemaining[eid] = Math.max(0, NPC.drawRemaining[eid] - dt);
  }

  // Humanoids face local +Z, so this yaw points the bandit's chest, head,
  // and held weapon at the player throughout both pursuit and melee guard.
  Rotation.yaw[eid] = Math.atan2(dx, dz);

  if (distToPlayer > attackRange) {
    NPC.state[eid] = NpcState.CHASING;
    seekPlayer(eid, playerEid, NPC.moveSpeed[eid] || archetype.chaseSpeed || FOLLOW_SPEED, attackRange);
    return;
  }

  NPC.state[eid] = NpcState.ATTACKING;
  Velocity.x[eid] = 0;
  Velocity.z[eid] = 0;

  NPC.attackCooldownRemaining[eid] -= dt;
  // Same stamina gate as the player's own tryMeleeAttack (ATTACK_STAMINA_COST.cross,
  // since this is the one generic swing every aggressive NPC reuses) -- an
  // NPC that's out of stamina just keeps waiting in ATTACKING with its
  // cooldown already elapsed, ready to swing the instant it regenerates
  // enough, rather than ever forcing a free attack through. Missing the
  // Stamina component entirely (a hand-built test NPC, say) reads as
  // `undefined` here (a plain array, not a real bitecs query) and skips the
  // gate rather than blocking every attack, the same fallback
  // tryMeleeAttack uses.
  const hasStamina = Stamina.current[eid] !== undefined;
  if (NPC.drawRemaining[eid] <= 0 && NPC.attackCooldownRemaining[eid] <= 0
      && (!hasStamina || Stamina.current[eid] >= ATTACK_STAMINA_COST.cross)) {
    triggerAttack(eid);
    const fallbackDamage = archetype.weaponClass === "oneHanded" ? 7 : archetype.weaponClass === "dagger" ? 5 : 3;
    const fallbackReach = archetype.weaponClass === "oneHanded" ? 1.4 : archetype.weaponClass === "dagger" ? 1.0 : UNARMED_REACH;
    const shape = ATTACK_SHAPES.cross; // NPCs have no jab/cross/chop of their own -- a neutral generic swing
    // Humanoids face local +Z (see the yaw comment above), the opposite of
    // the player's own camera-only -Z convention -- registerMeleeSwing
    // takes a resolved direction rather than a bare yaw for exactly this
    // reason (see its own doc comment).
    registerMeleeSwing(eid, Math.sin(Rotation.yaw[eid]), Math.cos(Rotation.yaw[eid]), (archetype.attackReach ?? fallbackReach) * shape.reachMultiplier, shape.width, shape.height, archetype.attackDamage ?? fallbackDamage, ATTACK_ACTIVE_WINDOW.cross);
    if (hasStamina) Stamina.current[eid] -= ATTACK_STAMINA_COST.cross;
    NPC.attackCooldownRemaining[eid] = archetype.attackCooldown ?? 1;
  }
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
