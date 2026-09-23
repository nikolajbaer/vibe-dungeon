import * as THREE from "three";
import { addComponent, hasComponent, query, removeComponent, type World } from "bitecs";
import { Carried, Combat, Dead, DynamicBody, Embedded, Health, Item, Object3DRef, PhysicsBody, PhysicsRotation, PlayerControlled, Position, Stamina } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import type { ItemAssetDef } from "../../assets/types";
import { releaseViewmodelThrow, startViewmodelThrowCharge } from "./items";
import { ATTACK_PROFILES, ATTACK_STAMINA_COST, applyRangedDamage, getEquippedWeaponInHand, handCombatFields, mainHand } from "./combat";
import type { HandSlot } from "./items";
import { BODY_PART_DAMAGE_MULTIPLIER, getBodyPartAt } from "./meleeCollision";
import { reflectBounceVelocity } from "./rangedCombat";
import { buildItemWorldBody, dropCarriedItem } from "../../level/spawning";
import type { Physics } from "../../physics/world";

/**
 * The javelin-style "self-thrown weapon" attack -- see
 * `ItemAssetDef.throwable`'s own doc comment for why this is a separate
 * module from `rangedCombat.ts` rather than a generalization of it: there's
 * no separate ammo item here, the weapon entity itself becomes the flying
 * projectile, and it fires through the shared melee jab-or-charge-and-release
 * input (`combat.ts`) rather than a dedicated aim-and-fire button.
 *
 * Flight is simulated by hand -- a raycast swept along a manually-integrated
 * gravity arc, closely mirroring `rangedCombat.ts`'s own flying bolts --
 * rather than handed off to a real Rapier rigid body. A real body was tried
 * first (see this file's git history) and worked for the "does it fly and
 * hit things" mechanics, but couldn't give a thrown weapon the one thing a
 * javelin actually needs: sticking cleanly into whatever it hits, the way a
 * fired bolt already does (`rangedCombat.ts`'s embedding). A live physics
 * body that's *also* meant to end up embedded and motionless fights itself --
 * hand-rolled flight, exactly like the bolt's own, doesn't have that
 * conflict. "Knock things over" is handled explicitly here instead of
 * falling out of Rapier's own solver for free: a hit on a genuinely dynamic
 * prop (a barrel, a dropped item) applies a real impulse to *that* object's
 * own physics body (see `resolveHit` below), which is what actually knocks
 * it over -- the javelin itself never re-enables its own body mid-flight.
 */

interface EquippedThrowable {
  itemEid: number;
  def: ItemAssetDef & { throwable: NonNullable<ItemAssetDef["throwable"]> };
}

function getEquippedThrowable(world: World, ownerEid: number, hand: HandSlot): EquippedThrowable | undefined {
  const weapon = getEquippedWeaponInHand(world, ownerEid, hand);
  if (!weapon) return undefined;
  const def = ITEM_REGISTRY[Item.itemTypeId[weapon.itemEid]];
  if (!def?.throwable) return undefined;
  return { itemEid: weapon.itemEid, def: def as EquippedThrowable["def"] };
}

/** True if `hand`'s currently-equipped weapon (the same one
 * `tryMeleeAttack`/jab would use for that hand) is a throwable one -- lets
 * game.ts decide, at press time, whether a held charge for that hand should
 * raise the throwing-ready pose (`tryStartThrowCharge` below) instead of the
 * melee swing chamber (`combat.ts`'s `tryStartSwingCharge`), the same way it
 * already decides melee-vs-ranged via `getEquippedRangedWeapon`. `hand` left
 * unset resolves via `combat.ts`'s `mainHand` -- see `tryMeleeAttack`'s own
 * doc comment there for what that means (a lone javelin, like any other lone
 * weapon, commonly lands in `hand-left` -- `items.ts`'s `findOpenHandSlot`
 * fills left before right -- so this can't just default to `"hand-right"`). */
export function isEquippedWeaponThrowable(world: World, ownerEid: number, hand?: HandSlot): boolean {
  return getEquippedThrowable(world, ownerEid, hand ?? mainHand(world, ownerEid)) !== undefined;
}

/**
 * Starts charging a throw -- the throwable analog of `combat.ts`'s
 * `tryStartSwingCharge`, refusing under the same conditions (cooldown,
 * blocking, already charging, not enough stamina for the shared `swing`
 * cost -- a javelin doesn't declare its own `attackMultipliers`, so no
 * per-weapon multiplier lookup is needed here), all checked for `hand`
 * specifically (`combat.ts`'s `handCombatFields`) so a dual-wielded javelin
 * in either hand can be charged independently of whatever the other hand is
 * doing. Raises the weapon into its throwing-ready pose (`items.ts`'s
 * `startViewmodelThrowCharge`) and leaves it there until `tryThrowWeapon`
 * (release) or `combat.ts`'s `cancelSwingCharge` (which is charge-type-
 * agnostic -- see its own doc comment) drops it. `hand` left unset resolves
 * via `mainHand`, same as `isEquippedWeaponThrowable` above.
 */
export function tryStartThrowCharge(world: World, hand?: HandSlot): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined) return false;
  const resolvedHand = hand ?? mainHand(world, attackerEid);
  const { recovery: recoveryField, charging: chargingField } = handCombatFields(world, attackerEid, resolvedHand);
  if (recoveryField[attackerEid] > 0 || Combat.blocking[attackerEid] > 0 || chargingField[attackerEid] > 0) return false;
  const throwable = getEquippedThrowable(world, attackerEid, resolvedHand);
  if (!throwable) return false;
  const cost = ATTACK_STAMINA_COST.swing;
  if (hasComponent(world, attackerEid, Stamina) && Stamina.current[attackerEid] < cost) return false;
  chargingField[attackerEid] = 1;
  startViewmodelThrowCharge(throwable.itemEid);
  return true;
}

/** Meters ahead of the camera a throw launches from -- the same "begin at
 * the camera, not further out" reasoning `rangedCombat.ts`'s own bolts use
 * (a muzzle offset can otherwise place the projectile on the far side of a
 * nearby wall, so the first frame never sees the impact), nudged forward
 * just enough to clear the player's own movement capsule. */
const THROW_MUZZLE_OFFSET = 0.4;

/** Gravity (m/s^2) a thrown javelin falls under -- deliberately gentle, the
 * same reasoning `rangedCombat.ts`'s own `BOLT_GRAVITY` (4) gives: the
 * world's real gravity (physics/world.ts's `GRAVITY_Y`, -24) is tuned for a
 * snappy character fall, not projectile ballistics, and would nose-dive a
 * fast, thin throw into the floor within a couple of meters. Drop over a
 * given distance scales with (distance / speed)^2, so a javelin flying at
 * half a bolt's speed (`javelin.ts`'s `projectileSpeed: 12` vs. the bolt's
 * own 34) needs a *much* gentler pull than the bolt's own to arc the same
 * amount over the same distance, not the same constant -- a first pass here
 * that reused a flat "a bit above the bolt's own 4" value (6) sank into the
 * floor well short of normal combat range once the speed came down. This
 * keeps the same "arcs a little more than the bolt" feel (a fixed multiple
 * of the bolt's own drop-per-distance) at this weapon's own, slower speed. */
const THROW_GRAVITY = 1.5;

/** How far (m) the tip visually sinks into whatever it embeds in -- deep
 * enough to read as genuinely stuck rather than just touching the surface,
 * shallow enough that most of the shaft still shows. Independent of the
 * weapon's own length (`tipOffset` below, measured per-throw off the actual
 * mesh) -- a bigger weapon doesn't need a proportionally deeper hole, just a
 * consistent one. */
const EMBED_DEPTH = 0.12;

/** Below this speed (m/s) a hit is treated as a weak graze that clatters off
 * rather than a real stick -- keeps a javelin that's already lost most of
 * its momentum (e.g. from an earlier bounce) from freezing motionless
 * in place the instant it grazes anything. */
const MIN_EMBED_SPEED = 2;

/** Fraction of a thrown javelin's own momentum (mass * velocity) actually
 * imparted to a dynamic prop it hits (a barrel, a dropped item) -- real
 * collisions aren't perfectly momentum-transferring (some of it goes into
 * the javelin's own deceleration), so this is deliberately less than 1,
 * tuned to still read as a solid, weighty impact rather than a tap. */
const PROP_IMPULSE_FRACTION = 0.7;

const raycaster = new THREE.Raycaster();

function owningEid(object: THREE.Object3D): number | undefined {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (typeof current.userData.eid === "number") return current.userData.eid;
  }
  return undefined;
}

/** `hit.normal` (per three.js's `Mesh.raycast`) is in the struck object's
 * *local* space -- transformed to world space here, or a level floor's
 * normal as a fallback if the geometry didn't carry one. Duplicated from
 * `rangedCombat.ts`'s own private equivalent (not exported) -- small enough
 * that sharing it isn't worth the coupling. */
function worldSurfaceNormal(hit?: THREE.Intersection): THREE.Vector3 {
  return hit?.normal ? hit.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
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
  /** Local +Z distance from the mesh's own origin (the grip -- see
   * javelin.ts's own header comment on this repo-wide "tip forward"
   * convention) to its visual tip, measured off the actual mesh geometry
   * once at throw time -- how deep the embed-origin math (`embeddedOrigin`
   * below) needs to walk the origin back from the surface for the tip to
   * land right at `EMBED_DEPTH`, and generic to whatever a future thrown
   * weapon's own proportions happen to be, no hardcoded per-weapon number. */
  tipOffset: number;
}

const flyingThrown: FlyingThrown[] = [];

/** Where a stuck javelin's mesh origin (its local Z=0, the grip -- see
 * `FlyingThrown.tipOffset`'s own doc comment) belongs in world space, given
 * the raycast `hitPoint`, the struck surface's world-space unit `normal`,
 * and the javelin's own world-space unit travel `direction` -- the same
 * "walk the tip in from the surface, then walk the origin back from the tip
 * along the actual flight direction" derivation `rangedCombat.ts`'s
 * `embeddedBoltOrigin` uses for a fired bolt, just parameterized by this
 * weapon's own `tipOffset` instead of a bolt-specific constant. */
function embeddedOrigin(hitPoint: THREE.Vector3, normal: THREE.Vector3, direction: THREE.Vector3, tipOffset: number): THREE.Vector3 {
  return hitPoint.clone().addScaledVector(normal, -EMBED_DEPTH).addScaledVector(direction, -tipOffset);
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
 * `buildItemWorldBody`/`pickUpItem`) rather than spawning a fresh one --
 * building one on the spot only for the rare case where it doesn't exist yet
 * (a javelin seeded straight into `Carried` with no in-world history, e.g.
 * NPC/container starting loot). `hand` left unset resolves via `mainHand`
 * (same as `tryStartThrowCharge`, and for the same reason) and picks which
 * literal hand's charge this releases and which hand's own recovery timer
 * gets set -- see `tryMeleeAttack`'s own doc comment (combat.ts) for why.
 */
export function tryThrowWeapon(world: World, physics: Physics, camera: THREE.Camera, scene: THREE.Scene, hand?: HandSlot): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined) return false;
  const resolvedHand = hand ?? mainHand(world, attackerEid);
  const { recovery: recoveryField, charging: chargingField } = handCombatFields(world, attackerEid, resolvedHand);
  if (!(chargingField[attackerEid] > 0)) return false;
  chargingField[attackerEid] = 0;
  const throwable = getEquippedThrowable(world, attackerEid, resolvedHand);
  if (!throwable) return false;

  const cost = ATTACK_STAMINA_COST.swing;
  recoveryField[attackerEid] = ATTACK_PROFILES.swing.recovery;
  if (hasComponent(world, attackerEid, Stamina)) Stamina.current[attackerEid] -= cost;

  const itemEid = throwable.itemEid;
  releaseViewmodelThrow(itemEid);

  if (!hasComponent(world, itemEid, Object3DRef)) {
    buildItemWorldBody(world, physics, scene, itemEid, throwable.def, 0, 0, 0);
  }
  // Flight is hand-simulated (see this file's header comment), not driven by
  // Rapier -- keep the body disabled the whole time, same as while carried,
  // so nothing else in the physics world reacts to it until it's dropped
  // back in (`dropCarriedItem`) or stuck in place (`embedJavelin`).
  PhysicsBody[itemEid]?.setEnabled(false);
  removeComponent(world, itemEid, Carried);
  // `dynamicSyncSystem`/`syncSystem` would otherwise keep copying this
  // item's (now-frozen, disabled) physics body transform onto its mesh every
  // frame -- fighting the hand-simulated flight this file drives directly.
  // Removed here, re-added by `embedJavelin` (`Position` only, `Embedded`
  // takes over from there) or `clatter` (both, once it's a normal loose item
  // again) once flight actually ends.
  removeComponent(world, itemEid, Position);
  removeComponent(world, itemEid, PhysicsRotation);

  const mesh = Object3DRef[itemEid]!;
  mesh.visible = true;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction).normalize();
  const position = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, THROW_MUZZLE_OFFSET);
  mesh.position.copy(position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

  // `mesh` here is already the pickup-hitbox-wrapped group (`Object3DRef`),
  // not the bare visual mesh -- its first child is the real geometry (see
  // `withPickupHitbox`), which is what actually needs measuring; the
  // group's own bounds would be dominated by the much larger invisible
  // pickup hitbox sphere.
  const visualMesh = mesh.children[0] ?? mesh;
  const tipOffset = new THREE.Box3().setFromObject(visualMesh).max.z;

  flyingThrown.push({
    itemEid, mesh, position,
    velocity: direction.multiplyScalar(throwable.def.throwable.projectileSpeed),
    distance: 0, maxRange: throwable.def.throwable.maxRange, damage: throwable.def.throwable.damage, attackerEid, tipOffset,
  });
  return true;
}

/** Sticks `thrown` into whatever it just hit -- reparented onto `hit.object`
 * (`Object3D.attach` preserves world transform across the reparent) so it
 * follows a moving target the same way an embedded bolt does. `thrown.mesh`
 * has been a direct child of `scene` for its entire flight, so its
 * position/quaternion are already world-space; no reset-to-identity dance
 * is needed the way a freshly-created bolt mesh needs one. */
function embedJavelin(world: World, thrown: FlyingThrown, hit: THREE.Intersection, normal: THREE.Vector3, direction: THREE.Vector3): void {
  const group = thrown.mesh;
  group.position.copy(embeddedOrigin(hit.point, normal, direction, thrown.tipOffset));
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  addComponent(world, thrown.itemEid, Embedded);
  // `Position` only, not `PhysicsRotation` -- same as a fired bolt's own
  // embed (see `Embedded`'s doc comment): `syncSystem`'s quaternion loop has
  // no `Embedded` skip, so re-adding `PhysicsRotation` here would fight the
  // orientation `attach()` below already gave the mesh.
  addComponent(world, thrown.itemEid, Position);
  Position.x[thrown.itemEid] = group.position.x;
  Position.y[thrown.itemEid] = group.position.y;
  Position.z[thrown.itemEid] = group.position.z;
  hit.object.attach(group);
}

/** Ends a throw as a normal loose world item again -- a failed embed, a hit
 * on a dynamic prop, or simply running out of range -- rather than staying
 * stuck (`embedJavelin`). Re-adds `Position`/`PhysicsRotation` (both this
 * time, unlike `embedJavelin`: this item isn't `Embedded`, so it needs the
 * full pair the generic sync pipeline expects of any ordinary dynamic body)
 * and sets them to match the physics body `dropCarriedItem` is about to
 * plant at `point`, identity rotation and all -- `dynamicSyncSystem` won't
 * read that body back out until *next* frame's physics step, one frame after
 * `syncSystem` (this frame's) needs correct values to draw from. */
function clatter(world: World, physics: Physics, scene: THREE.Scene, thrown: FlyingThrown, point: THREE.Vector3): void {
  addComponent(world, thrown.itemEid, Position);
  addComponent(world, thrown.itemEid, PhysicsRotation);
  Position.x[thrown.itemEid] = point.x;
  Position.y[thrown.itemEid] = point.y;
  Position.z[thrown.itemEid] = point.z;
  PhysicsRotation.x[thrown.itemEid] = 0;
  PhysicsRotation.y[thrown.itemEid] = 0;
  PhysicsRotation.z[thrown.itemEid] = 0;
  PhysicsRotation.w[thrown.itemEid] = 1;
  dropCarriedItem(world, physics, scene, thrown.itemEid, point.x, point.y, point.z);
}

/** Decides whether `thrown` sticks into whatever it just hit (`embedJavelin`)
 * or clatters off instead -- too shallow an angle or too little speed left
 * (`MIN_EMBED_SPEED`) fails to embed, the same "a real hit sometimes just
 * glances off" idea `rangedCombat.ts`'s bolts use, just phrased in terms of
 * this weapon's own measured `tipOffset` rather than a bolt-specific
 * constant. A failed embed reflects the javelin's own incoming velocity off
 * the struck surface (`reflectBounceVelocity`, shared with the bolt's own
 * clatter) rather than just dropping it dead at the impact point. */
function embedOrClatter(world: World, physics: Physics, scene: THREE.Scene, thrown: FlyingThrown, hit: THREE.Intersection, normal: THREE.Vector3, direction: THREE.Vector3): void {
  const speed = thrown.velocity.length();
  const incidence = Math.abs(direction.dot(normal));
  const minIncidence = Math.min(0.95, EMBED_DEPTH / thrown.tipOffset);
  if (speed >= MIN_EMBED_SPEED && incidence >= minIncidence) {
    embedJavelin(world, thrown, hit, normal, direction);
    return;
  }
  clatter(world, physics, scene, thrown, hit.point);
  const body = PhysicsBody[thrown.itemEid];
  if (body) {
    const reflected = reflectBounceVelocity(thrown.velocity, normal);
    body.setLinvel({ x: reflected.x, y: reflected.y, z: reflected.z }, true);
  }
}

/**
 * Resolves a raycast hit into whichever of three outcomes actually applies:
 * a living, `Health`-bearing target takes damage (bypassing melee blocking
 * entirely, the same as a fired bolt) and then embeds or clatters
 * (`embedOrClatter`); a genuinely dynamic prop (`DynamicBody` -- a barrel, a
 * dropped item, never a kinematic character, which is immune to being
 * physically shoved -- see physics/world.ts's own header comment on why)
 * gets a real impulse applied to *its own* physics body at the actual impact
 * point (`applyImpulseAtPoint`, which imparts some spin/tip along with the
 * push for an off-center hit) and the javelin itself just clatters nearby,
 * rather than trying to embed in something that might now be tumbling; raw
 * level geometry (a wall/floor, no owning entity at all) always goes through
 * `embedOrClatter` too.
 */
function resolveHit(world: World, physics: Physics, scene: THREE.Scene, thrown: FlyingThrown, hit: THREE.Intersection): void {
  const direction = thrown.velocity.clone().normalize();
  const normal = worldSurfaceNormal(hit);
  const targetEid = owningEid(hit.object);

  if (targetEid !== undefined && hasComponent(world, targetEid, Health) && !hasComponent(world, targetEid, Dead)) {
    const part = getBodyPartAt(targetEid, hit.point.y);
    const damage = part ? thrown.damage * BODY_PART_DAMAGE_MULTIPLIER[part] : thrown.damage;
    applyRangedDamage(world, targetEid, damage, thrown.attackerEid, part);
    embedOrClatter(world, physics, scene, thrown, hit, normal, direction);
    return;
  }

  if (targetEid !== undefined && hasComponent(world, targetEid, DynamicBody)) {
    const body = PhysicsBody[targetEid];
    if (body) {
      const mass = ITEM_REGISTRY[Item.itemTypeId[thrown.itemEid]]?.mass ?? 1;
      const impulseMag = mass * thrown.velocity.length() * PROP_IMPULSE_FRACTION;
      const impulse = direction.clone().multiplyScalar(impulseMag);
      body.applyImpulseAtPoint({ x: impulse.x, y: impulse.y, z: impulse.z }, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, true);
    }
    clatter(world, physics, scene, thrown, hit.point);
    return;
  }

  embedOrClatter(world, physics, scene, thrown, hit, normal, direction);
}

/** Advances every javelin currently in flight -- the same manual swept-
 * raycast approach `rangedCombat.ts`'s flying bolts use (see this file's
 * header comment for why), so it can stick wherever it lands
 * (`embedJavelin`) or clatter (`embedOrClatter`/`resolveHit`'s prop branch)
 * once it hits something or runs out of range. */
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
      resolveHit(world, physics, scene, thrown, hit);
      flyingThrown.splice(i, 1);
      continue;
    }
    thrown.position.add(step);
    thrown.distance += stepLength;
    thrown.mesh.position.copy(thrown.position);
    thrown.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), thrown.velocity.clone().normalize());
    if (thrown.distance >= thrown.maxRange) {
      clatter(world, physics, scene, thrown, thrown.position);
      flyingThrown.splice(i, 1);
    }
  }
}

export function getThrowingCombatDebugState(): { flying: number } {
  return { flying: flyingThrown.length };
}
