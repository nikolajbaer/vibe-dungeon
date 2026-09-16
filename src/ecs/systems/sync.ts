import { query, type World } from "bitecs";
import { Position, Rotation, Object3DRef, PhysicsRotation, PlayerControlled, RenderOffsetY } from "../components";

/** Copies ECS transform data into the corresponding three.js Object3D
 * (an NPC's mesh, a world item, or the player's camera). Runs last, right
 * before render.
 *
 * `RenderOffsetY` covers entities whose visual origin isn't their physics
 * origin — today just the player, whose `Object3DRef` is the camera and so
 * belongs at eye height rather than at the feet `Position` now tracks.
 * Door leaves don't appear here at all (they have no `Position` — their
 * hinge group and physics body are both driven straight from the swing
 * angle by `doorAnimationSystem`), and static geometry no longer has ECS
 * entities to sync. */
export function syncSystem(world: World): void {
  for (const eid of query(world, [Position, Object3DRef])) {
    const obj = Object3DRef[eid];
    if (!obj) continue;
    obj.position.set(Position.x[eid], Position.y[eid] + (RenderOffsetY[eid] ?? 0), Position.z[eid]);
  }

  // Only the player entity currently has meaningful Rotation (yaw/pitch);
  // walls and doors don't rotate.
  for (const eid of query(world, [Rotation, Object3DRef, PlayerControlled])) {
    const obj = Object3DRef[eid];
    if (!obj) continue;
    obj.rotation.set(Rotation.pitch[eid], Rotation.yaw[eid], 0, "YXZ");
  }

  // Dynamic bodies (pushable props, loose world items) tumble on all three
  // axes, so they carry a full quaternion rather than the yaw/pitch pair
  // above — a chair knocked onto its side isn't expressible as a yaw.
  for (const eid of query(world, [PhysicsRotation, Object3DRef])) {
    const obj = Object3DRef[eid];
    if (!obj) continue;
    obj.quaternion.set(PhysicsRotation.x[eid], PhysicsRotation.y[eid], PhysicsRotation.z[eid], PhysicsRotation.w[eid]);
  }
}
