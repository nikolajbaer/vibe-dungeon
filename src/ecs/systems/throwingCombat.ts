import * as THREE from "three";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import { hasComponent, query, removeComponent, type World } from "bitecs";
import { Carried, Combat, Dead, Health, Item, Object3DRef, PhysicsBody, PlayerControlled, Stamina } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import type { ItemAssetDef } from "../../assets/types";
import { releaseViewmodelThrow, startViewmodelThrowCharge } from "./items";
import { ATTACK_PROFILES, ATTACK_STAMINA_COST, applyRangedDamage, getEquippedWeapon } from "./combat";
import { BODY_PART_DAMAGE_MULTIPLIER, getCombatHitboxColliders } from "./meleeCollision";
import { buildItemWorldBody } from "../../level/spawning";
import type { CombatBodyPart, Physics } from "../../physics/world";

/**
 * The javelin-style "self-thrown weapon" attack -- see
 * `ItemAssetDef.throwable`'s own doc comment for why this is a separate
 * module from `rangedCombat.ts` rather than a generalization of it: there's
 * no separate ammo item here, the weapon entity itself becomes the flying
 * projectile, and it fires through the shared melee jab-or-charge-and-release
 * input (`combat.ts`) rather than a dedicated aim-and-fire button.
 *
 * Unlike a fired bolt (which simulates its own flight by hand -- a raycast
 * swept along a manually-integrated gravity arc, entirely independent of
 * Rapier), a thrown weapon here is a *real* Rapier rigid body for its whole
 * flight: the item's own existing dynamic physics body (already CCD-enabled
 * -- see `addDynamicBox` in physics/world.ts -- so a fast throw can't tunnel
 * through a thin wall in one step) is simply re-enabled and given a launch
 * velocity, then left alone; `physics.world.step()` and the already-generic
 * `dynamicSyncSystem`/`syncSystem` pipeline (game.ts) actually move and
 * render it every frame after, the exact same way they already drive every
 * other dropped item or shoved prop.
 *
 * That's also what "imparts inertia to knock things over" actually is:
 * Rapier's own solver, not anything this file does -- a solid, real-mass
 * body moving at real velocity hitting a dynamic prop (a barrel, a chair)
 * shoves it exactly the way any other physical collision in this world
 * already does, for free. Hitting a *character* is the one case that needs
 * help from this file: characters are kinematic (moved by explicit
 * position sets, immune to being physically shoved -- see physics/world.ts's
 * own header comment on why), so `throwingCombatSystem` below watches for
 * that specific overlap itself and calls `applyRangedDamage`, the same way
 * a bolt's raycast hit does.
 */

interface EquippedThrowable {
  itemEid: number;
  def: ItemAssetDef & { throwable: NonNullable<ItemAssetDef["throwable"]> };
}

function getEquippedThrowable(world: World, ownerEid: number): EquippedThrowable | undefined {
  const weapon = getEquippedWeapon(world, ownerEid);
  if (!weapon) return undefined;
  const def = ITEM_REGISTRY[Item.itemTypeId[weapon.itemEid]];
  if (!def?.throwable) return undefined;
  return { itemEid: weapon.itemEid, def: def as EquippedThrowable["def"] };
}

/** True if the player's currently-equipped weapon (the same one
 * `tryMeleeAttack`/jab would use) is a throwable one -- lets game.ts decide,
 * at press time, whether a held charge should raise the throwing-ready pose
 * (`tryStartThrowCharge` below) instead of the melee swing chamber
 * (`combat.ts`'s `tryStartSwingCharge`), the same way it already decides
 * melee-vs-ranged via `getEquippedRangedWeapon`. */
export function isEquippedWeaponThrowable(world: World, ownerEid: number): boolean {
  return getEquippedThrowable(world, ownerEid) !== undefined;
}

/**
 * Starts charging a throw -- the throwable analog of `combat.ts`'s
 * `tryStartSwingCharge`, refusing under the same conditions (cooldown,
 * blocking, already charging, not enough stamina for the shared `swing`
 * cost -- a javelin doesn't declare its own `attackMultipliers`, so no
 * per-weapon multiplier lookup is needed here). Raises the weapon into its
 * throwing-ready pose (`items.ts`'s `startViewmodelThrowCharge`) and leaves
 * it there until `tryThrowWeapon` (release) or `combat.ts`'s
 * `cancelSwingCharge` (which is charge-type-agnostic -- see its own doc
 * comment) drops it.
 */
export function tryStartThrowCharge(world: World): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || Combat.attackRecovery[attackerEid] > 0 || Combat.blocking[attackerEid] > 0 || Combat.charging[attackerEid] > 0) return false;
  const throwable = getEquippedThrowable(world, attackerEid);
  if (!throwable) return false;
  const cost = ATTACK_STAMINA_COST.swing;
  if (hasComponent(world, attackerEid, Stamina) && Stamina.current[attackerEid] < cost) return false;
  Combat.charging[attackerEid] = 1;
  startViewmodelThrowCharge(throwable.itemEid);
  return true;
}

/** Meters ahead of the camera a throw launches from -- clears the player's
 * own movement capsule (`PLAYER_RADIUS` in game.ts, 0.35m) with real margin,
 * so the freshly-enabled body doesn't spawn overlapping it and get an
 * unwanted overlap-resolution shove the instant it's created. */
const THROW_MUZZLE_OFFSET = 0.6;

/** How much of the world's real gravity (`physics/world.ts`'s `GRAVITY_Y`,
 * tuned for a snappy character fall, not ballistics) a thrown javelin
 * actually feels -- applying the full character-scale gravity to a fast,
 * thin projectile would nose-dive it into the floor within a couple of
 * meters. Matches `rangedCombat.ts`'s own bolt gravity (4 m/s^2) as a
 * fraction of the world's -24, so a thrown javelin arcs the same gentle way
 * a fired bolt does despite being simulated by Rapier instead of by hand. */
const THROW_GRAVITY_SCALE = 4 / 24;

/** Extra horizontal margin (m) added to a character's own combat hitbox
 * cylinder radius when checking whether a flying javelin has reached it
 * (`findStruckCharacter` below) -- the javelin is a thin, fast-moving line
 * sampled once per rendered frame, not a continuously-swept point, so a real
 * solid hit Rapier's own collision response already registered against the
 * character's capsule can land just outside a bare point-in-cylinder test. */
const HIT_CHECK_RADIUS_PAD = 0.15;

/** Fraction of a javelin's velocity left once it's confirmed to have struck
 * a character -- without this it would keep sliding at full throw speed
 * against (or through, next physics step) whatever it just hit, since a
 * kinematic character never absorbs any of a dynamic body's momentum the
 * way a shoved prop would. Damping it here reads as the target's own body
 * absorbing the impact, and lets it drop to the floor near them shortly
 * after instead of riding along, stuck against their capsule. */
const IMPACT_VELOCITY_DAMPING = 0.15;

interface LiveThrow {
  itemEid: number;
  attackerEid: number;
  damage: number;
  elapsed: number;
  /** Seconds after which this throw stops being checked for a fresh hit
   * (`throwable.maxRange / throwable.projectileSpeed`) -- once past this,
   * it's simply left as whatever ordinary landed item Rapier's own physics
   * has already settled it into, the same as any other dropped item; there's
   * nothing left to do here since the entity was never anything other than a
   * real, permanently-tracked `DynamicBody` item to begin with. */
  timeout: number;
  /** The item's own physics collider, local-space (relative to the body's
   * own origin and rotation) offset and half-length along its long axis
   * (+Z, the "tip forward" convention every weapon mesh in this repo uses --
   * see e.g. sword.ts's own header comment) -- read once at throw time from
   * the body's actual collider shape (`addDynamicBox`'s box, itself computed
   * off the mesh's real geometry by `boxShapeOf`). A javelin is long enough
   * (~1.3m) that its own origin (the grip) can sit well behind wherever the
   * blade tip -- and the real point of physical contact -- currently is;
   * `findStruckCharacter` below samples several points along this span each
   * frame instead of only the origin, so a hit registers wherever along the
   * shaft it actually connects. */
  localOffsetX: number;
  localOffsetY: number;
  localNearZ: number;
  localFarZ: number;
}

const liveThrows: LiveThrow[] = [];

/** How many evenly-spaced points (inclusive of both ends) to sample along a
 * flying weapon's own length each frame when checking for a character hit
 * (see `LiveThrow.local*` fields above) -- enough that even the ~1.3m
 * javelin's own length never has more than a small fraction of a meter
 * between sample points, well under a character's own hitbox radius. */
const HIT_CHECK_SAMPLE_COUNT = 5;

const hitCheckPoint = new THREE.Vector3();
const hitCheckQuat = new THREE.Quaternion();

/** The struck character (if any) currently overlapping any sampled point
 * along `thrown`'s own length -- reuses `meleeCollision.ts`'s already-
 * registered combat hitbox cylinders (the same ones a melee swing box tests
 * against) rather than issuing a fresh Rapier query, since a plain
 * point-in-cylinder check against a handful of characters is cheap enough to
 * do inline every frame -- the same reasoning `getBodyPartAt`
 * (rangedCombat.ts's own equivalent) gives for reusing these colliders' live
 * getters instead of a real intersection test. */
function findStruckCharacter(world: World, thrown: LiveThrow, body: RigidBody, excludeEid: number): { eid: number; part: CombatBodyPart } | undefined {
  const pos = body.translation();
  const rot = body.rotation();
  hitCheckQuat.set(rot.x, rot.y, rot.z, rot.w);
  for (let i = 0; i < HIT_CHECK_SAMPLE_COUNT; i++) {
    const f = i / (HIT_CHECK_SAMPLE_COUNT - 1);
    const localZ = thrown.localNearZ + (thrown.localFarZ - thrown.localNearZ) * f;
    hitCheckPoint.set(thrown.localOffsetX, thrown.localOffsetY, localZ).applyQuaternion(hitCheckQuat);
    hitCheckPoint.x += pos.x;
    hitCheckPoint.y += pos.y;
    hitCheckPoint.z += pos.z;
    for (const owner of getCombatHitboxColliders()) {
      if (owner.eid === excludeEid) continue;
      if (!hasComponent(world, owner.eid, Health) || hasComponent(world, owner.eid, Dead)) continue;
      const t = owner.collider.translation();
      const horizontalDist = Math.hypot(hitCheckPoint.x - t.x, hitCheckPoint.z - t.z);
      if (horizontalDist > owner.collider.radius() + HIT_CHECK_RADIUS_PAD) continue;
      const halfHeight = owner.collider.halfHeight();
      if (hitCheckPoint.y < t.y - halfHeight || hitCheckPoint.y > t.y + halfHeight) continue;
      return { eid: owner.eid, part: owner.part };
    }
  }
  return undefined;
}

/**
 * Releases a charge started by `tryStartThrowCharge`, actually throwing the
 * weapon -- the throwable analog of `combat.ts`'s `releaseSwingCharge`,
 * doing the same recovery/stamina bookkeeping that function does for a
 * melee swing release, but detaching the weapon from the hand entirely
 * (`items.ts`'s `releaseViewmodelThrow`) and launching it as a real physics
 * body (see this file's header comment) instead of registering a melee
 * swing box. A stray release with nothing charging is a harmless no-op,
 * same as `releaseSwingCharge`.
 *
 * Reuses the weapon's own existing world-pickup entity/mesh/physics-body
 * (present on any item that's ever been placed in the world -- see
 * `buildItemWorldBody`/`pickUpItem`) rather than spawning a fresh one --
 * building one on the spot only for the rare case where it doesn't exist yet
 * (a javelin seeded straight into `Carried` with no in-world history, e.g.
 * NPC/container starting loot).
 */
export function tryThrowWeapon(world: World, physics: Physics, camera: THREE.Camera, scene: THREE.Scene): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || !(Combat.charging[attackerEid] > 0)) return false;
  Combat.charging[attackerEid] = 0;
  const throwable = getEquippedThrowable(world, attackerEid);
  if (!throwable) return false;

  const cost = ATTACK_STAMINA_COST.swing;
  Combat.attackRecovery[attackerEid] = ATTACK_PROFILES.swing.recovery;
  if (hasComponent(world, attackerEid, Stamina)) Stamina.current[attackerEid] -= cost;

  const itemEid = throwable.itemEid;
  releaseViewmodelThrow(itemEid);

  if (!hasComponent(world, itemEid, Object3DRef)) {
    buildItemWorldBody(world, physics, scene, itemEid, throwable.def, 0, 0, 0);
  }
  removeComponent(world, itemEid, Carried);

  const mesh = Object3DRef[itemEid]!;
  mesh.visible = true;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction).normalize();
  const muzzle = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, THROW_MUZZLE_OFFSET);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  const speed = throwable.def.throwable.projectileSpeed;

  const body = PhysicsBody[itemEid]!;
  body.setEnabled(true);
  body.setTranslation({ x: muzzle.x, y: muzzle.y, z: muzzle.z }, true);
  body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
  body.setLinvel({ x: direction.x * speed, y: direction.y * speed, z: direction.z * speed }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.setGravityScale(THROW_GRAVITY_SCALE, true);
  // Every other dynamic item/prop carries heavy linear/angular damping
  // (physics/world.ts's `PROP_LINEAR_DAMPING`/`PROP_ANGULAR_DAMPING`, tuned
  // for furniture that shouldn't slide forever once shoved) -- a real thrown
  // weapon needs to actually cross the room at something close to its launch
  // speed, so both are dropped to (near) zero for the flight; nothing resets
  // them afterward, since a landed weapon behaving a little more slidy than
  // an ordinary dropped item if kicked again is harmless.
  body.setLinearDamping(0);
  body.setAngularDamping(0.05);

  // Matches the physics body immediately, rather than waiting for the next
  // physics step's `dynamicSyncSystem` pass, so the very first rendered
  // frame after the throw doesn't show it still sitting wherever it was
  // hidden while carried.
  mesh.position.copy(muzzle);
  mesh.quaternion.copy(quat);

  // Read the collider's own local-space span along its long axis (see
  // `LiveThrow`'s own doc comment) once, here -- it never changes for the
  // rest of this throw's flight, only the body's world position/rotation do.
  const collider = body.numColliders() > 0 ? body.collider(0) : undefined;
  const localOffset = collider?.translationWrtParent() ?? { x: 0, y: 0, z: 0 };
  const localHalf = collider?.halfExtents() ?? { x: 0, y: 0, z: 0 };

  liveThrows.push({
    itemEid, attackerEid, damage: throwable.def.throwable.damage,
    elapsed: 0, timeout: throwable.def.throwable.maxRange / speed,
    localOffsetX: localOffset.x, localOffsetY: localOffset.y,
    localNearZ: localOffset.z - localHalf.z, localFarZ: localOffset.z + localHalf.z,
  });
  return true;
}

/** Advances every javelin currently eligible to land a fresh hit -- real
 * flight/impact physics already happened in `physics.world.step()` and
 * `dynamicSyncSystem` (game.ts's own fixed-timestep loop, which runs before
 * this) by the time this sees each one's current position; all this does is
 * watch for the one thing plain Rapier collision can't handle on its own
 * (see this file's header comment): a hit on a kinematic character. */
export function throwingCombatSystem(world: World, dt: number): void {
  for (let i = liveThrows.length - 1; i >= 0; i--) {
    const thrown = liveThrows[i];
    thrown.elapsed += dt;
    const body = PhysicsBody[thrown.itemEid];
    if (!body) {
      liveThrows.splice(i, 1);
      continue;
    }
    const struck = findStruckCharacter(world, thrown, body, thrown.attackerEid);
    if (struck) {
      const damage = thrown.damage * BODY_PART_DAMAGE_MULTIPLIER[struck.part];
      applyRangedDamage(world, struck.eid, damage, thrown.attackerEid, struck.part);
      const v = body.linvel();
      body.setLinvel({ x: v.x * IMPACT_VELOCITY_DAMPING, y: v.y * IMPACT_VELOCITY_DAMPING, z: v.z * IMPACT_VELOCITY_DAMPING }, true);
      liveThrows.splice(i, 1);
      continue;
    }
    if (thrown.elapsed >= thrown.timeout) liveThrows.splice(i, 1);
  }
}

export function getThrowingCombatDebugState(): { flying: number } {
  return { flying: liveThrows.length };
}
