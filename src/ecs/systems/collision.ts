import { query, type World } from "bitecs";
import { Position, Collider, Solid, Door, PlayerControlled, NPC } from "../components";

/** A door counts as solid until it's most of the way open, so movers
 * can't walk "through" a door that's still mid-swing. */
const DOOR_SOLID_UNTIL_PROGRESS = 0.9;

/**
 * Axis-aligned box collision between every "mover" — currently the player
 * and the follow NPC (issue #36) — and static level geometry (walls,
 * closed/opening doors). Uses minimum-translation-vector (MTV) resolution:
 * push the mover out along whichever axis has the smaller overlap. Because
 * only one axis is corrected at a time, motion along the other axis is
 * preserved — this is what makes a mover slide along a wall instead of
 * stopping dead when approaching at an angle.
 *
 * Movers are resolved against level geometry only, not against each other
 * (NPC-vs-player overlap is fine for now, per issue #36) — a `PlayerControlled`
 * query and an `NPC` query are concatenated into one set rather than
 * queried together, since bitECS's `query` returns an intersection (AND) of
 * its component list, not a union.
 */
export function collisionSystem(world: World): void {
  const movers = [
    ...query(world, [PlayerControlled, Position, Collider]),
    ...query(world, [NPC, Position, Collider]),
  ];
  const walls = query(world, [Position, Collider, Solid]);
  const doors = query(world, [Position, Collider, Door]);

  for (const mover of movers) {
    for (const wall of walls) {
      resolvePair(mover, wall);
    }
    for (const door of doors) {
      if (Door.progress[door] >= DOOR_SOLID_UNTIL_PROGRESS) continue;
      resolvePair(mover, door);
    }
  }
}

function resolvePair(mover: number, other: number): void {
  const dx = Position.x[mover] - Position.x[other];
  const dz = Position.z[mover] - Position.z[other];
  const overlapX = Collider.hx[mover] + Collider.hx[other] - Math.abs(dx);
  const overlapZ = Collider.hz[mover] + Collider.hz[other] - Math.abs(dz);
  if (overlapX <= 0 || overlapZ <= 0) return; // boxes don't actually overlap

  if (overlapX < overlapZ) {
    Position.x[mover] += overlapX * Math.sign(dx || 1);
  } else {
    Position.z[mover] += overlapZ * Math.sign(dz || 1);
  }
}
