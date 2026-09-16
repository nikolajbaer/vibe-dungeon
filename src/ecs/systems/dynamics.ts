import { query, type World } from "bitecs";
import { DynamicBody, PhysicsBody, PhysicsRotation, Position } from "../components";

// Reads simulated bodies back out of Rapier. The mirror image of
// `characterSystem`: a character's `Velocity` is an input the physics world
// resolves, whereas a dynamic prop or world item is moved entirely by
// gravity, contacts and shoves, so there is nothing to write *in* — this
// system only ever copies out.
//
// Runs right after `world.step()`, alongside `physicsSyncSystem`, so the
// transforms it publishes are from the step that just happened rather than
// the one before.

/**
 * Copies every dynamic body's translation and orientation into `Position` and
 * `PhysicsRotation`, which `syncSystem` then applies to the three.js mesh.
 *
 * `addDynamicBox` deliberately puts the body's frame on the *mesh origin* (the
 * collider carries the offset to the shape's real center instead), so both are
 * a straight copy with no per-asset correction — a prop's origin sits on its
 * floor and the sword's at its grip, and neither needs special-casing here.
 *
 * A body that Rapier has put to sleep still reports its last transform, so
 * settled furniture costs a cheap read per frame and nothing else.
 */
export function dynamicSyncSystem(world: World): void {
  for (const eid of query(world, [DynamicBody, Position, PhysicsRotation])) {
    const body = PhysicsBody[eid];
    if (!body) continue;

    const t = body.translation();
    Position.x[eid] = t.x;
    Position.y[eid] = t.y;
    Position.z[eid] = t.z;

    const r = body.rotation();
    PhysicsRotation.x[eid] = r.x;
    PhysicsRotation.y[eid] = r.y;
    PhysicsRotation.z[eid] = r.z;
    PhysicsRotation.w[eid] = r.w;
  }
}
