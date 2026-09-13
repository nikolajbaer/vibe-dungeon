import * as THREE from "three";
import { addComponent, hasComponent, query, type World } from "bitecs";
import { Carried, Dead, Health, Item, Object3DRef, PlayerControlled } from "../components";
import { ITEM_TYPES } from "../../items/itemTypes";
import { isHandSlot, triggerViewmodelSwing } from "./items";

/** Damage dealt with no weapon equipped (issue #48 follow-up: fists vs. a
 * sword shouldn't hit the same). */
export const UNARMED_DAMAGE = 5;
const MELEE_RANGE = 2; // meters — shorter than tryInteract's 3m reach (see doors.ts)

const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();

/** The attacker's best equipped weapon (highest `meleeDamage` among items
 * carried in a hand slot), or `undefined` if unarmed — either no hand item
 * is equipped, or what's equipped (e.g. a future shield) isn't a weapon.
 * Picking the *best* of the two hands rather than, say, always the right
 * hand means a second weapon in the off hand can only ever help, never
 * accidentally downgrade an attack. */
function getEquippedWeapon(world: World, attackerEid: number): { itemEid: number; damage: number } | undefined {
  let best: { itemEid: number; damage: number } | undefined;
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== attackerEid) continue;
    if (!isHandSlot(Carried.slot[eid])) continue;
    const damage = ITEM_TYPES[Item.itemTypeId[eid]]?.meleeDamage;
    if (damage === undefined) continue;
    if (!best || damage > best.damage) best = { itemEid: eid, damage };
  }
  return best;
}

/**
 * Melee attack trigger (issue #48): a raycast straight out from the camera
 * (same technique as `tryInteract` in doors.ts, but its own separate
 * raycast/candidate list — this is a different verb, not another
 * `tryInteract` dispatch case) hits the nearest damageable entity within
 * `MELEE_RANGE` meters and deals damage to its `Health` — `UNARMED_DAMAGE`
 * bare-handed, or the equipped weapon's `meleeDamage` (see
 * `getEquippedWeapon` above) if the attacker (assumed to be the single
 * `PlayerControlled` entity — combat has no other attackers yet) has one in
 * a hand slot.
 *
 * Targets are every entity carrying both `Health` and `Object3DRef` (so
 * anything damageable automatically becomes attackable, not just NPCs),
 * excluding anything already `Dead` (a corpse can't be hit again) and the
 * camera's own `Object3DRef` (the attacker can't hit itself — relevant once
 * the player entity, which also carries `Health`, is ever passed as its own
 * target list member: its `Object3DRef` *is* the camera, so it's filtered
 * out here rather than via a separate attacker-eid parameter).
 *
 * On a kill (`Health.current` reaches 0): adds the `Dead` tag and removes
 * the entity's mesh from the scene outright (`removeFromParent`) rather than
 * just hiding it, per the acceptance criteria ("mesh gone").
 *
 * Swings the attacker's weapon viewmodel (if any) on every attempt,
 * hit or miss, since a swing is what the *player* did, independent of
 * whether it connected — see `triggerViewmodelSwing`/`viewmodelSwingSystem`
 * in items.ts.
 *
 * Returns true if the hit target actually took damage.
 */
export function tryMeleeAttack(world: World, camera: THREE.Camera): boolean {
  const [attackerEid] = query(world, [PlayerControlled]);
  const weapon = attackerEid !== undefined ? getEquippedWeapon(world, attackerEid) : undefined;
  const damage = weapon?.damage ?? UNARMED_DAMAGE;
  if (weapon) triggerViewmodelSwing(weapon.itemEid);

  const targets: THREE.Object3D[] = [];
  for (const eid of query(world, [Health, Object3DRef])) {
    if (hasComponent(world, eid, Dead)) continue;
    const obj = Object3DRef[eid];
    if (!obj || obj === (camera as unknown as THREE.Object3D)) continue;
    targets.push(obj);
  }
  if (targets.length === 0) return false;

  camera.getWorldDirection(forward);
  raycaster.set(camera.position, forward);
  raycaster.far = MELEE_RANGE;

  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length === 0) return false;

  const hitEid = hits[0].object.userData.eid as number | undefined;
  if (hitEid === undefined) return false;

  Health.current[hitEid] = Math.max(0, Health.current[hitEid] - damage);

  if (Health.current[hitEid] <= 0 && !hasComponent(world, hitEid, Dead)) {
    addComponent(world, hitEid, Dead);
    Object3DRef[hitEid]?.removeFromParent();
  }

  return true;
}
