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

// First dungeon expansion (issue #71): a branch off the corridor's middle
// cell (world cell (0,-2)), turning the straight room-a/corridor/room-b line
// into a real choice point. `corridor`'s `id`/`originCell`/`rotation`/
// `sectorId` are all unchanged from the original layout — only its
// `tileTypeId` moved from `hallway` to `hallway_junction` (a strict superset
// of `hallway`'s openings, see tiles.ts), so both original doors, the player
// spawn, the NPC, both world items, and room-a's furniture are all
// unaffected. See docs/LEVEL_DESIGN.md's "worked example" section for the
// reasoning behind retrofitting the corridor rather than room-a/room-b.
//
// The junction's new east-facing opening (at world cell (0,-2)/(1,-2)) feeds
// a `hallway` instance rotated 90 degrees ("branch-corridor", cells
// (1,-2)-(3,-2), running east-west) into a new small room, "side-chamber"
// (`side_chamber`, cells (4,-2)-(5,-1)), whose one door (local west, z=0)
// meets the branch corridor's east end at world cell (3,-2)/(4,-2).

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
    tileTypeId: "hallway_junction",
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
  {
    id: "branch-corridor",
    tileTypeId: "hallway",
    originCell: { x: 1, z: -2 },
    rotation: 90,
    sectorId: "branch-corridor",
  },
  {
    id: "side-chamber",
    tileTypeId: "side_chamber",
    originCell: { x: 4, z: -2 },
    rotation: 0,
    sectorId: "side-chamber",
  },
];

/** Spawn point, inside room-a (now 9m x 9m), facing south (-z) down the
 * corridor — matches the old level's "start in room A, corridor heads away
 * from you" feel. */
export const LEVEL_SPAWN = { x: 1.5, z: 7.5, yaw: 0 };
