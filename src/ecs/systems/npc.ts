import { hasComponent, query, type World } from "bitecs";
import { Dead, Health, NPC, NpcState, Position, Rotation, Stamina, Velocity, PlayerControlled, Practice } from "../components";
import { NPC_REGISTRY } from "../../assets/npcRegistry";
import type { NpcArchetypeDef } from "../../assets/types";
import { isMovementLocked, triggerAttack, triggerWeaponDraw } from "./npcAnimation";
import { NPC_ATTACK_ACTIVE_WINDOW, NPC_ATTACK_SHAPE, NPC_ATTACK_STAMINA_COST, UNARMED_REACH } from "./combat";
import { isHostileTo, registerMeleeSwing } from "./meleeCollision";

/** Looks up which sector a world position falls in -- `level/level.ts`'s
 * `Level.sectorAt`, threaded in as a plain function (rather than importing
 * the `Level` type here) so this module stays decoupled from level-building
 * code entirely. Used by `updateAggressive`'s leash check below. */
export type SectorAt = (x: number, y: number, z: number) => string | undefined;

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
export function npcSystem(world: World, dt: number, sectorAt: SectorAt): void {
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

    if (NPC.staggerRemaining[eid] > 0) {
      // Stunned by a ranged hit (combat.ts's applyRangedDamage) -- frozen
      // in place, no wander/chase/attack decision at all, until it wears
      // off, the same "just count it down" shape as a docile archetype's
      // wanderTimer.
      NPC.staggerRemaining[eid] = Math.max(0, NPC.staggerRemaining[eid] - dt);
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
      updateAggressive(world, eid, archetype, dt, sectorAt, true);
      continue;
    }
    if (testStyle === "defensive") {
      if (NPC.provoked[eid]) updateAggressive(world, eid, archetype, dt, sectorAt, true);
      else {
        Velocity.x[eid] = 0;
        Velocity.z[eid] = 0;
      }
      continue;
    }
    const sparring = hasComponent(world, eid, Practice) && !!Practice.active[eid];
    if (archetype?.behavior === "aggressive" || sparring || !!NPC.provoked[eid]) {
      updateAggressive(world, eid, archetype, dt, sectorAt, sparring);
      continue;
    }

    if (NPC.state[eid] === NpcState.FOLLOWING && playerEid !== undefined) {
      seekTarget(eid, playerEid, FOLLOW_SPEED, FOLLOW_STOP_DISTANCE);
    } else {
      wander(eid, dt);
    }
  }
}

/** Moves `eid` toward `targetEid` at `speed`, stopping once within
 * `stopDistance` — shared by docile `FOLLOWING` (always the player) and
 * aggressive `CHASING` (whatever `findHostileTarget` picked, which just
 * uses its own `chaseSpeed`/`attackRange` instead of
 * `FOLLOW_SPEED`/`FOLLOW_STOP_DISTANCE`). */
function seekTarget(eid: number, targetEid: number, speed: number, stopDistance: number): void {
  const dx = Position.x[targetEid] - Position.x[eid];
  const dz = Position.z[targetEid] - Position.z[eid];
  const dist = Math.hypot(dx, dz);

  if (dist <= stopDistance) {
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;
    return;
  }

  Velocity.x[eid] = (dx / dist) * speed;
  Velocity.z[eid] = (dz / dist) * speed;
}

/**
 * The nearest entity `eid` (an aggressive/provoked NPC) is hostile to --
 * the player, or any other NPC on a different `NPC.team` (`isHostileTo`,
 * meleeCollision.ts) -- for `updateAggressive` to chase/attack, in place of
 * the old hardcoded "always the player." Re-picked fresh every frame rather
 * than remembered once acquired: the simplest version of the mechanic (this
 * codebase's own "v1, simple" bar elsewhere), and a real behavior in its
 * own right -- an NPC mid-fight will redirect to a nearer threat that shows
 * up, the same way `distToPlayer`/`homeDist` below were already recomputed
 * fresh every frame with no memory of their own. `undefined` means no one
 * to fight (every hostile candidate is dead, or there simply isn't one). */
function findHostileTarget(world: World, eid: number): number | undefined {
  let bestEid: number | undefined;
  let bestDist = Infinity;
  const consider = (candidateEid: number): void => {
    if (candidateEid === eid) return;
    if (hasComponent(world, candidateEid, Dead)) return;
    if (!isHostileTo(world, eid, candidateEid)) return;
    const dx = Position.x[candidateEid] - Position.x[eid];
    const dz = Position.z[candidateEid] - Position.z[eid];
    const dist = Math.hypot(dx, dz);
    if (dist < bestDist) {
      bestDist = dist;
      bestEid = candidateEid;
    }
  };
  const [playerEid] = query(world, [PlayerControlled, Position]);
  if (playerEid !== undefined) consider(playerEid);
  for (const otherEid of query(world, [NPC, Position, Health])) consider(otherEid);
  return bestEid;
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
 * docile archetype until a hostile target (the player, or another NPC on a
 * different team — `findHostileTarget`) comes within `archetype.aggroRange`
 * (a plain distance check — no line-of-sight, see that field's doc comment
 * in `assets/types.ts`), then `CHASING` closes in at `archetype.chaseSpeed`
 * until within `archetype.attackRange`, then `ATTACKING` stops and swings
 * (a real hit-detection box, `archetype.attackDamage` at `archetype.attackReach`
 * — see `meleeCollision.ts`) every `archetype.attackCooldown` seconds for as
 * long as the target stays in range (stepping back out to `CHASING` if they
 * retreat) — being in `attackRange` triggers the swing, not a guaranteed
 * hit, since the swing's own box is a separate, real geometric test. The
 * chase itself is relentless -- retreating, however far, never shakes it on
 * its own -- but once the NPC and target have actually shared a sector at
 * some point since the chase began (`NPC.reachedTargetSector`), the instant
 * the target's sector (`sectorAt`) diverges from the NPC's own current one
 * again, it gives up and returns to `LOITERING`: leaving the room (or
 * whatever sector boundary a door/threshold marks) is what actually loses
 * an established chase, not distance. The "actually shared a sector" gate
 * matters because `aggroRange` has no line-of-sight check -- a chase can
 * begin with the target already on the other side of a wall or a door an
 * NPC can never open itself, and leashing on that mismatch immediately
 * would give up before the chase ever had a real chance to close the gap.
 * Re-checked fresh every frame like everything else here, so an NPC still
 * hot on the target's heels when they both cross the same threshold just
 * keeps going, while one that's fallen behind gives up right at the doorway
 * instead of tunneling through walls to close an unbounded distance. A
 * sparring bout always targets the player specifically (never
 * `findHostileTarget`) and never leashes at all -- a training dummy that
 * wandered off (or gave up) mid-bout would defeat the point.
 */
function updateAggressive(world: World, eid: number, archetype: NpcArchetypeDef, dt: number, sectorAt: SectorAt, sparring = false): void {
  const targetEid = sparring ? query(world, [PlayerControlled, Position])[0] : findHostileTarget(world, eid);
  if (targetEid === undefined) {
    // Nothing left to fight -- stand down from a chase/attack rather than
    // freezing mid-battle-stance; already-LOITERING just keeps wandering.
    if (NPC.state[eid] !== NpcState.LOITERING) giveUpAndLoiter(eid);
    else wander(eid, dt);
    return;
  }

  if (NPC.state[eid] === NpcState.LOITERING) {
    const dx = Position.x[targetEid] - Position.x[eid];
    const dz = Position.z[targetEid] - Position.z[eid];
    if (sparring || Math.hypot(dx, dz) <= (archetype.aggroRange ?? 0)) {
      NPC.state[eid] = NpcState.CHASING;
      NPC.drawRemaining[eid] = .5;
      NPC.reachedTargetSector[eid] = 0;
      triggerWeaponDraw(eid);
    } else {
      wander(eid, dt);
    }
    return;
  }

  // CHASING or ATTACKING from here — give up the instant the target leaves
  // whatever sector the NPC is currently standing in, but only once the two
  // have actually shared a sector at some point since this chase began
  // (`NPC.reachedTargetSector`'s own doc comment explains why: `aggroRange`
  // has no line-of-sight check, so a chase can begin with the target
  // already in a different sector -- behind a wall, or a closed door an NPC
  // can never open itself -- and leashing immediately in that case would
  // give up before ever getting a real chance to close the distance).
  const ownSector = sectorAt(Position.x[eid], Position.y[eid], Position.z[eid]);
  const targetSector = sectorAt(Position.x[targetEid], Position.y[targetEid], Position.z[targetEid]);
  if (targetSector === ownSector) NPC.reachedTargetSector[eid] = 1;
  else if (!sparring && NPC.reachedTargetSector[eid]) {
    giveUpAndLoiter(eid);
    return;
  }

  const dx = Position.x[targetEid] - Position.x[eid];
  const dz = Position.z[targetEid] - Position.z[eid];
  const distToTarget = Math.hypot(dx, dz);
  const attackRange = archetype.attackRange ?? (NPC.provoked[eid] ? 1.5 : 0);

  if (NPC.drawRemaining[eid] > 0) {
    if (triggerWeaponDraw(eid)) NPC.drawRemaining[eid] = Math.max(0, NPC.drawRemaining[eid] - dt);
  }

  // Humanoids face local +Z, so this yaw points the bandit's chest, head,
  // and held weapon at its target throughout both pursuit and melee guard.
  Rotation.yaw[eid] = Math.atan2(dx, dz);

  // Drawing, parrying, or flinching from a hit are upper-body-only poses
  // with no leg animation at all (`isMovementLocked`'s own doc comment) --
  // moving during one would slide across the floor rather than walk, so
  // this holds position (but keeps facing the target, above) until
  // whichever one finishes and hands back control to idle/walk/combatIdle.
  if (isMovementLocked(eid)) {
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;
    return;
  }

  if (distToTarget > attackRange) {
    NPC.state[eid] = NpcState.CHASING;
    seekTarget(eid, targetEid, NPC.moveSpeed[eid] || archetype.chaseSpeed || FOLLOW_SPEED, attackRange);
    return;
  }

  NPC.state[eid] = NpcState.ATTACKING;
  Velocity.x[eid] = 0;
  Velocity.z[eid] = 0;

  NPC.attackCooldownRemaining[eid] -= dt;
  // Same stamina gate as the player's own tryMeleeAttack (NPC_ATTACK_STAMINA_COST,
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
      && (!hasStamina || Stamina.current[eid] >= NPC_ATTACK_STAMINA_COST)) {
    triggerAttack(eid);
    const fallbackDamage = archetype.weaponClass === "oneHanded" ? 7 : archetype.weaponClass === "dagger" ? 5 : 3;
    const fallbackReach = archetype.weaponClass === "oneHanded" ? 1.4 : archetype.weaponClass === "dagger" ? 1.0 : UNARMED_REACH;
    const shape = NPC_ATTACK_SHAPE; // NPCs have no jab/charged-swing distinction of their own -- a neutral generic swing
    // Humanoids face local +Z (see the yaw comment above), the opposite of
    // the player's own camera-only -Z convention -- registerMeleeSwing
    // takes a resolved direction rather than a bare yaw for exactly this
    // reason (see its own doc comment).
    registerMeleeSwing(eid, Math.sin(Rotation.yaw[eid]), Math.cos(Rotation.yaw[eid]), (archetype.attackReach ?? fallbackReach) * shape.reachMultiplier, shape.width, shape.height, archetype.attackDamage ?? fallbackDamage, NPC_ATTACK_ACTIVE_WINDOW);
    if (hasStamina) Stamina.current[eid] -= NPC_ATTACK_STAMINA_COST;
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
