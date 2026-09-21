import * as THREE from "three";
import { hasComponent, query, type World } from "bitecs";
import type { Collider } from "@dimforge/rapier3d-compat";
import { CharacterBody, Dead, Health, PhysicsBody, Position } from "../components";
import { addCombatHitboxes, queryCombatHitboxes, type CombatBodyPart, type MeleeSwingBox, type Physics } from "../../physics/world";

// Real collision-volume melee hit detection, replacing what used to be two
// unrelated mechanisms with genuinely different fidelity: the player's own
// attack raycast one thin ray from the camera, an NPC's a flat horizontal
// distance check with no geometry test at all. Both now go through the same
// path -- `registerMeleeSwing` (called from combat.ts's `tryMeleeAttack` and
// npc.ts's `updateAggressive`) queues a swing, and `meleeCollisionSystem`
// (called once per rendered frame from game.ts, which also owns applying the
// damage this module resolves -- see its own doc comment for why that stays
// out of here) resolves it against real Rapier sensor geometry.

/** Damage multiplier per struck body part -- ranged hits only
 * (rangedCombat.ts's `applyRangedDamage` call). Melee moved to a flat,
 * uniform hit (see `meleeCollisionSystem` below) as part of the shift
 * toward a Skyrim-like feel: aiming for a headshot with a bolt is still
 * worth more, but a sword swing no longer cares which of the three
 * cylinders it happened to land on. Torso is the implicit 1.0 baseline
 * every other multiplier is relative to. */
export const BODY_PART_DAMAGE_MULTIPLIER: Record<CombatBodyPart, number> = {
  head: 1.15,
  torso: 1.0,
  legs: 0.8,
};

/** How far above an attacker's feet a swing box is centered -- roughly
 * chest height, matching where a one-handed swing actually happens rather
 * than at the eyes (camera height) or the ground. A flat constant rather
 * than derived per-attacker: every humanoid in this game (player included)
 * is close enough in build that a shared height reads fine, and it keeps
 * the box's vertical placement decoupled from any one character's own
 * capsule dimensions. */
const SWING_HEIGHT_ABOVE_FEET = 1.0;

// Registered eids (any entity with Health+CharacterBody+PhysicsBody) already
// carrying combat hitbox cylinders, and the collider-handle -> (eid, part,
// the collider itself) lookup a swing's query results resolve back through.
const registeredEids = new Set<number>();
const colliderOwners = new Map<number, { eid: number; part: CombatBodyPart; collider: Collider }>();

/** Attaches combat hitbox cylinders (see `addCombatHitboxes`) to every
 * combatant that doesn't have them yet. Lazy rather than wired into each
 * spawn site (game.ts's player setup, spawning.ts's NPC setup) since
 * `CharacterBody`/`PhysicsBody`/`Health` are already tracked generically for
 * both -- cheap to re-check every tick via `registeredEids`. */
function ensureCombatHitboxes(world: World, physics: Physics): void {
  for (const eid of query(world, [Health, CharacterBody, PhysicsBody])) {
    if (registeredEids.has(eid)) continue;
    const body = PhysicsBody[eid];
    if (!body) continue;
    registeredEids.add(eid);
    for (const { collider, part } of addCombatHitboxes(physics, body, CharacterBody.radius[eid], CharacterBody.halfHeight[eid])) {
      colliderOwners.set(collider.handle, { eid, part, collider });
    }
  }
}

/** Removes a dead combatant's combat hitbox colliders from the physics
 * world and this module's own bookkeeping -- without this, a corpse's
 * cylinders would sit in Rapier (and keep showing up in the hitbox debug
 * overlay) forever, since death only ever adds `Dead`, never touches
 * `PhysicsBody` (see combat.ts's `applyMeleeDamage`/`applyRangedDamage`).
 * `eid` stays in `registeredEids` even after this so `ensureCombatHitboxes`
 * never tries to re-attach hitboxes to a corpse. Doesn't change hit
 * resolution at all -- `meleeCollisionSystem` already skips `Dead` targets
 * on its own -- this is purely cleanup. */
function pruneDeadHitboxes(world: World, physics: Physics): void {
  for (const [handle, owner] of colliderOwners) {
    if (!hasComponent(world, owner.eid, Dead)) continue;
    physics.world.removeCollider(owner.collider, true);
    colliderOwners.delete(handle);
  }
}

/** Every currently-attached combat hitbox collider, for the play-testing
 * debug overlay (`hitboxDebug.ts`) to draw a real wireframe cylinder at --
 * reading the collider's own `.translation()`/`.rotation()` each frame
 * keeps that overlay perfectly in sync with the actual query geometry
 * without this module needing to publish anything about *where* a
 * combatant is itself. */
export function getCombatHitboxColliders(): { eid: number; part: CombatBodyPart; collider: Collider }[] {
  return Array.from(colliderOwners.values());
}

/** Which of `eid`'s three combat hitbox cylinders a world-space height `y`
 * falls inside, if any -- for rangedCombat.ts to turn a bolt's raycast hit
 * point into a body part the same way a melee swing's box query already
 * does, without needing a second real Rapier query (a bolt already has its
 * exact hit point in hand; this is just arithmetic against each cylinder's
 * own live `.translation()`/`.halfHeight()`, cheap enough to do inline). No
 * query-pipeline staleness concern here, unlike `queryCombatHitboxes` --
 * these are plain getters on colliders that already exist, not a fresh
 * intersection test. */
export function getBodyPartAt(eid: number, y: number): CombatBodyPart | undefined {
  for (const owner of colliderOwners.values()) {
    if (owner.eid !== eid) continue;
    const halfHeight = owner.collider.halfHeight();
    const centerY = owner.collider.translation().y;
    if (y >= centerY - halfHeight && y <= centerY + halfHeight) return owner.part;
  }
  return undefined;
}

interface PendingSwing {
  attackerEid: number;
  box: MeleeSwingBox;
  damage: number;
  remaining: number; // seconds left in the active window
}

const pendingSwings: PendingSwing[] = [];

/** Every currently-pending swing's attacker and box, for the same debug
 * overlay to draw the exact volume `meleeCollisionSystem` is actually
 * testing against, not an approximation of it. */
export function getPendingSwingBoxes(): { attackerEid: number; box: MeleeSwingBox }[] {
  return pendingSwings.map((swing) => ({ attackerEid: swing.attackerEid, box: swing.box }));
}

/**
 * Queues a melee swing's hit-detection box, computed once from the
 * attacker's position and facing *right now* and held fixed for the whole
 * active window rather than tracking the attacker (or an actual weapon
 * mesh) frame to frame -- deliberately decoupled from the weapon's visual
 * swing animation. A real swing is short and mostly stationary from the
 * attacker's perspective anyway, and a static box sidesteps the tunneling
 * problem a moving one would reintroduce (the same problem a fired
 * crossbow bolt has, solved there by sweeping a ray instead -- here the box
 * is simply large enough, and active long enough, to cover the whole swing
 * without needing to move at all).
 *
 * `dirX`/`dirZ` is the attacker's horizontal facing as a world-space unit
 * vector (not normalized here -- the caller's job, see below) rather than a
 * bare yaw read internally from `Rotation.yaw`: the player (no body mesh at
 * all -- `Object3DRef` is the camera itself) faces local -Z at yaw 0, the
 * same convention `inputSystem` already uses for its own forward vector,
 * while an NPC's humanoid rig faces local +Z (see npc.ts's own
 * `Rotation.yaw[eid] = Math.atan2(dx, dz)` comment) -- the *same* yaw value
 * means opposite physical directions for the two, so this module can't
 * safely assume either one and instead takes whichever the caller already
 * had to compute to face its target/aim in the first place.
 *
 * `reach`/`width`/`height` describe the box in meters: `reach` is how far it
 * extends in front of the attacker (already the caller's job to combine a
 * weapon's base reach with the current attack type's own shape -- a jab
 * thrusts narrow and long, a chop covers a wide arc — see combat.ts's
 * `ATTACK_SHAPES`), `width`/`height` its side-to-side and vertical extent.
 * `damage` is the final raw amount for this swing (weapon damage x attack
 * multiplier), before the struck body part's own multiplier is applied at
 * resolution time.
 */
export function registerMeleeSwing(
  attackerEid: number,
  dirX: number,
  dirZ: number,
  reach: number,
  width: number,
  height: number,
  damage: number,
  activeSeconds: number,
): void {
  const direction = new THREE.Vector3(dirX, 0, dirZ).normalize();
  const origin = new THREE.Vector3(Position.x[attackerEid], Position.y[attackerEid] + SWING_HEIGHT_ABOVE_FEET, Position.z[attackerEid]);
  const center = origin.addScaledVector(direction, reach / 2);
  // The box is symmetric along every local axis, so which way its local Z
  // ends up pointing (toward `direction` or away from it) doesn't matter --
  // setFromUnitVectors just needs *an* axis to align, and Z is as good as any.
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  pendingSwings.push({
    attackerEid,
    damage,
    remaining: activeSeconds,
    box: {
      cx: center.x,
      cy: center.y,
      cz: center.z,
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      hx: width / 2,
      hy: height / 2,
      hz: reach / 2,
    },
  });
}

export interface ResolvedMeleeHit {
  attackerEid: number;
  targetEid: number;
  /** Whichever cylinder the swing box happened to overlap first -- no
   * longer picked for its damage multiplier (melee hits are flat now, see
   * `BODY_PART_DAMAGE_MULTIPLIER`'s doc comment), kept only so the hitbox
   * debug overlay can flash the one cylinder that was actually struck
   * rather than all three. */
  part: CombatBodyPart;
  /** The swing's flat damage (weapon damage x attack-type multiplier,
   * already computed by the caller) -- the caller (combat.ts's
   * `applyMeleeDamage`, wired up in game.ts) applies this directly. */
  damage: number;
}

/**
 * Advances every pending swing's active window and, once its box overlaps
 * at least one valid target, resolves and removes it -- "count one
 * collision for the swing," the first valid target/part the query happens
 * to find (arbitrary among several simultaneous targets in one wide swing;
 * melee no longer favors a particular body part -- see
 * `BODY_PART_DAMAGE_MULTIPLIER`'s doc comment). A swing whose window closes
 * with no overlap is simply dropped; a miss is a miss. Doesn't apply any
 * damage itself -- returns what resolved this tick so the caller (game.ts)
 * can hand it to combat.ts's `applyMeleeDamage`, which is what actually
 * knows about block mitigation, death, and practice-mode scoring. Keeping
 * that out of this module avoids a circular import (combat.ts already
 * needs to call `registerMeleeSwing` above).
 */
export function meleeCollisionSystem(world: World, physics: Physics, dt: number): ResolvedMeleeHit[] {
  ensureCombatHitboxes(world, physics);
  pruneDeadHitboxes(world, physics);
  const resolved: ResolvedMeleeHit[] = [];
  for (let i = pendingSwings.length - 1; i >= 0; i--) {
    const swing = pendingSwings[i];
    swing.remaining -= dt;
    let hit: { eid: number; part: CombatBodyPart } | undefined;
    for (const collider of queryCombatHitboxes(physics, swing.box)) {
      const owner = colliderOwners.get(collider.handle);
      if (!owner || owner.eid === swing.attackerEid) continue; // never hit yourself
      if (hasComponent(world, owner.eid, Dead)) continue;
      hit = { eid: owner.eid, part: owner.part };
      break;
    }
    if (hit) {
      resolved.push({ attackerEid: swing.attackerEid, targetEid: hit.eid, part: hit.part, damage: swing.damage });
      pendingSwings.splice(i, 1);
    } else if (swing.remaining <= 0) {
      pendingSwings.splice(i, 1);
    }
  }
  return resolved;
}
