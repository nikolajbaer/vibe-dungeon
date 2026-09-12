import type { TileInstance } from "./occupancy";

// The level, authored as tile instances (issue #21) — replaces the
// hand-placed geometry that used to live directly in level.ts. Same rough
// shape as the original test level (see issue #9): a starting room, a
// corridor, and a second room, with door interaction along the way.
//
// Room A (great_hall, unrotated) has its one door on its south face at grid
// x=0; a single hallway instance (already 9m long, d=3) runs south from
// there; room-b (great_hall, rotated 180 so its own door faces north) sits
// at the far end. Because both rooms are the *same* tile type, each
// contributes a door where it meets the corridor — two doors instead of the
// original single hand-placed one, which is a fine, arguably nicer,
// consequence of reusing one room type rather than a deviation to work
// around.

export const LEVEL_TILES: TileInstance[] = [
  {
    id: "room-a",
    tileTypeId: "great_hall",
    originCell: { x: -1, z: 0 },
    rotation: 0,
    sectorId: "room-a",
  },
  {
    id: "corridor",
    tileTypeId: "hallway",
    originCell: { x: 0, z: -3 },
    rotation: 0,
    sectorId: "corridor",
  },
  {
    id: "room-b",
    tileTypeId: "great_hall",
    originCell: { x: -1, z: -6 },
    rotation: 180,
    sectorId: "room-b",
  },
];

/** Spawn point, inside room-a (now 9m x 9m), facing south (-z) down the
 * corridor — matches the old level's "start in room A, corridor heads away
 * from you" feel. */
export const LEVEL_SPAWN = { x: 1.5, z: 7.5, yaw: 0 };
