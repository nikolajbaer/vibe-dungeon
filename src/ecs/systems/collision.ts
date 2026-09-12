import { query, type World } from "bitecs";
import { Position, Collider, Solid, Door, PlayerControlled } from "../components";

/** A door counts as solid until it's most of the way open, so the player
 * can't walk "through" a door that's still mid-swing. */
const DOOR_SOLID_UNTIL_PROGRESS = 0.9;

/**
 * Axis-aligned box collision between the player and static level geometry
 * (walls, closed/opening doors). Uses minimum-translation-vector (MTV)
 * resolution: push the player out along whichever axis has the smaller
 * overlap. Because only one axis is corrected at a time, motion along the
 * other axis is preserved — this is what makes the player slide along a
 * wall instead of stopping dead when approaching at an angle.
 */
export function collisionSystem(world: World): void {
  const players = query(world, [PlayerControlled, Position, Collider]);
  const walls = query(world, [Position, Collider, Solid]);
  const doors = query(world, [Position, Collider, Door]);

  for (const player of players) {
    for (const wall of walls) {
      resolvePair(player, wall);
    }
    for (const door of doors) {
      if (Door.progress[door] >= DOOR_SOLID_UNTIL_PROGRESS) continue;
      resolvePair(player, door);
    }
  }
}

function resolvePair(player: number, other: number): void {
  const dx = Position.x[player] - Position.x[other];
  const dz = Position.z[player] - Position.z[other];
  const overlapX = Collider.hx[player] + Collider.hx[other] - Math.abs(dx);
  const overlapZ = Collider.hz[player] + Collider.hz[other] - Math.abs(dz);
  if (overlapX <= 0 || overlapZ <= 0) return; // boxes don't actually overlap

  if (overlapX < overlapZ) {
    Position.x[player] += overlapX * Math.sign(dx || 1);
  } else {
    Position.z[player] += overlapZ * Math.sign(dz || 1);
  }
}
