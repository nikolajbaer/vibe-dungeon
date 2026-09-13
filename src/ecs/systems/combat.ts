import * as THREE from "three";
import { addComponent, hasComponent, query, type World } from "bitecs";
import { Dead, Health, Object3DRef } from "../components";

export const MELEE_DAMAGE = 15;
const MELEE_RANGE = 2; // meters — shorter than tryInteract's 3m reach (see doors.ts)

const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();

/**
 * Melee attack trigger (issue #48): a raycast straight out from the camera
 * (same technique as `tryInteract` in doors.ts, but its own separate
 * raycast/candidate list — this is a different verb, not another
 * `tryInteract` dispatch case) hits the nearest damageable entity within
 * `MELEE_RANGE` meters and deals `MELEE_DAMAGE` to its `Health`. Combat is
 * deliberately decoupled from equipment/inventory — this is a flat "you hit
 * something, it takes damage" mechanic regardless of what's equipped (or
 * whether inventory has landed at all).
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
 * Returns true if the hit target actually took damage.
 */
export function tryMeleeAttack(world: World, camera: THREE.Camera): boolean {
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

  Health.current[hitEid] = Math.max(0, Health.current[hitEid] - MELEE_DAMAGE);

  if (Health.current[hitEid] <= 0 && !hasComponent(world, hitEid, Dead)) {
    addComponent(world, hitEid, Dead);
    Object3DRef[hitEid]?.removeFromParent();
  }

  return true;
}
