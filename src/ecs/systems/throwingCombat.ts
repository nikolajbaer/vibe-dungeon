import * as THREE from "three";
import { hasComponent, query, removeComponent, type World } from "bitecs";
import { Carried, Combat, Dead, Health, Item, Object3DRef, PhysicsBody, PlayerControlled, Stamina } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import type { ItemAssetDef } from "../../assets/types";
import { releaseViewmodelThrow, startViewmodelThrowCharge } from "./items";
import { ATTACK_PROFILES, ATTACK_STAMINA_COST, applyRangedDamage, getEquippedWeapon } from "./combat";
import { BODY_PART_DAMAGE_MULTIPLIER, getBodyPartAt } from "./meleeCollision";
import { buildItemWorldBody, dropCarriedItem } from "../../level/spawning";
import type { Physics } from "../../physics/world";

/**
 * The javelin-style "self-thrown weapon" attack -- see
 * `ItemAssetDef.throwable`'s own doc comment for why this is a separate
 * module from `rangedCombat.ts` rather than a generalization of it: there's
 * no separate ammo item here, the weapon entity itself becomes the flying
 * projectile, and it fires through the shared melee jab-or-charge-and-release
 * input (`combat.ts`) rather than a dedicated aim-and-fire button. Mirrors
 * `rangedCombat.ts`'s flight/impact/recovery shape closely, just simpler
 * (no reload, no ammo stack, no embedding) -- a second thrown weapon type
 * showing up later is the point at which the two would actually get
 * generalized together, not before.
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

interface FlyingThrown {
  itemEid: number;
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  distance: number;
  maxRange: number;
  damage: number;
  attackerEid: number;
}

const flyingThrown: FlyingThrown[] = [];
const raycaster = new THREE.Raycaster();
const THROW_GRAVITY = 5;

function owningEid(object: THREE.Object3D): number | undefined {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (typeof current.userData.eid === "number") return current.userData.eid;
  }
  return undefined;
}

/**
 * Releases a charge started by `tryStartThrowCharge`, actually throwing the
 * weapon -- the throwable analog of `combat.ts`'s `releaseSwingCharge`,
 * doing the same recovery/stamina bookkeeping that function does for a
 * melee swing release, but detaching the weapon from the hand entirely
 * (`items.ts`'s `releaseViewmodelThrow`) and launching it as a tracked
 * flying projectile (`throwingCombatSystem` below) instead of registering a
 * melee swing box. A stray release with nothing charging is a harmless
 * no-op, same as `releaseSwingCharge`.
 *
 * Reuses the weapon's own existing world-pickup entity/mesh/physics-body
 * (present on any item that's ever been placed in the world -- see
 * `buildItemWorldBody`/`pickUpItem`) rather than spawning a fresh one, the
 * same "it's a real item, not a disposable visual" idea `dropCarriedItem`
 * already leans on for a plain drop -- building one on the spot for the
 * rare case where it doesn't exist yet (a javelin seeded straight into
 * `Carried` with no in-world history, e.g. NPC/container starting loot).
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
  PhysicsBody[itemEid]?.setEnabled(false);
  removeComponent(world, itemEid, Carried);

  const mesh = Object3DRef[itemEid]!;
  mesh.visible = true;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction).normalize();
  const position = camera.getWorldPosition(new THREE.Vector3());
  mesh.position.copy(position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

  flyingThrown.push({
    itemEid, mesh, position,
    velocity: direction.multiplyScalar(throwable.def.throwable.projectileSpeed),
    distance: 0, maxRange: throwable.def.throwable.maxRange, damage: throwable.def.throwable.damage, attackerEid,
  });
  return true;
}

function landThrown(world: World, physics: Physics, scene: THREE.Scene, thrown: FlyingThrown, point: THREE.Vector3): void {
  dropCarriedItem(world, physics, scene, thrown.itemEid, point.x, point.y, point.z);
}

/** Advances every javelin currently in flight -- same manual swept-raycast
 * approach `rangedCombat.ts`'s flying bolts use (rather than letting Rapier
 * drive it, since the item's own physics body stays disabled throughout the
 * flight -- see `tryThrowWeapon`), so it can land back on that exact body
 * (`dropCarriedItem`'s fast "reuse the existing one" path) once it hits
 * something or runs out of range. */
export function throwingCombatSystem(world: World, physics: Physics, scene: THREE.Scene, dt: number): void {
  for (let i = flyingThrown.length - 1; i >= 0; i--) {
    const thrown = flyingThrown[i];
    const previous = thrown.position.clone();
    thrown.velocity.y -= THROW_GRAVITY * dt;
    const step = thrown.velocity.clone().multiplyScalar(dt);
    const stepLength = step.length();
    const direction = step.clone().normalize();
    raycaster.set(previous, direction);
    raycaster.far = stepLength;
    const hit = raycaster.intersectObjects(scene.children, true).find((candidate) => {
      for (let current: THREE.Object3D | null = candidate.object; current; current = current.parent) {
        if (current === thrown.mesh || current instanceof THREE.Camera) return false;
      }
      return candidate.object.visible;
    });
    if (hit) {
      const targetEid = owningEid(hit.object);
      if (targetEid !== undefined && hasComponent(world, targetEid, Health) && !hasComponent(world, targetEid, Dead)) {
        const part = getBodyPartAt(targetEid, hit.point.y);
        const damage = part ? thrown.damage * BODY_PART_DAMAGE_MULTIPLIER[part] : thrown.damage;
        applyRangedDamage(world, targetEid, damage, thrown.attackerEid, part);
      }
      landThrown(world, physics, scene, thrown, hit.point);
      flyingThrown.splice(i, 1);
      continue;
    }
    thrown.position.add(step);
    thrown.distance += stepLength;
    thrown.mesh.position.copy(thrown.position);
    thrown.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), thrown.velocity.clone().normalize());
    if (thrown.distance >= thrown.maxRange) {
      landThrown(world, physics, scene, thrown, thrown.position);
      flyingThrown.splice(i, 1);
    }
  }
}

export function getThrowingCombatDebugState(): { flying: number } {
  return { flying: flyingThrown.length };
}
