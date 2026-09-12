import { query, type World } from "bitecs";
import { Position, Velocity } from "../components";

/** Integrates velocity into position. Runs before collisionSystem, which
 * corrects any resulting overlap with solid geometry. */
export function movementSystem(world: World, dt: number): void {
  for (const eid of query(world, [Position, Velocity])) {
    Position.x[eid] += Velocity.x[eid] * dt;
    Position.z[eid] += Velocity.z[eid] * dt;
  }
}
