import { hasComponent, query, type World } from "bitecs";
import { Position, Rotation, Object3DRef, PlayerControlled, Door } from "../components";

/** Copies ECS transform data into the corresponding three.js Object3D
 * (a wall/door mesh, or the player's camera). Runs last, right before
 * render. */
export function syncSystem(world: World): void {
  for (const eid of query(world, [Position, Object3DRef])) {
    const obj = Object3DRef[eid];
    if (!obj) continue;
    // Door leaves are the one exception: their Object3DRef is a hinge
    // THREE.Group positioned at the leaf's hinge point (set once at
    // creation in tileBuilder.ts), which is *not* the same point as
    // Position (kept at the leaf's closed-position center, for collision).
    // Overwriting it here every frame would fight doorAnimationSystem's
    // hinge rotation, so doors skip position-sync entirely — nothing else
    // ever needs to move a door's group.
    if (hasComponent(world, eid, Door)) continue;
    obj.position.set(Position.x[eid], Position.y[eid], Position.z[eid]);
  }

  // Only the player entity currently has meaningful Rotation (yaw/pitch);
  // walls and doors don't rotate.
  for (const eid of query(world, [Rotation, Object3DRef, PlayerControlled])) {
    const obj = Object3DRef[eid];
    if (!obj) continue;
    obj.rotation.set(Rotation.pitch[eid], Rotation.yaw[eid], 0, "YXZ");
  }
}
