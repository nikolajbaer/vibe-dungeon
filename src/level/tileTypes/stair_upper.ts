import type { TileType } from "../tiles";
import { wallsOf, STAIR_LANDING_HEIGHT_CELLS } from "../tiles";

/**
 * The upper terminus of a staircase (issue #86) — the mirror of
 * `stair_lower`: same 3m x 9m (3-cell) footprint, but open on its **west**
 * end instead (continuing the same horizontal direction of travel the
 * player was climbing in — see `rooms/stairwell.ts`'s `StairConnector`,
 * `axis: "x", direction: -1`), walled everywhere else including the east
 * end (which, on this floor, faces nothing — there's no floor-1 room east
 * of the stairwell).
 *
 * `skipFloorSlab` is the load-bearing part of this type: without it,
 * `buildGeometryFromOccupancy` would pour a normal floor slab across this
 * instance's whole footprint, sealing the shaft from above instead of
 * leaving the player to climb up through it on real ramp geometry (see
 * `TileType.skipFloorSlab`'s doc comment in `tiles.ts`, and `stairBuilder.ts`
 * for the ramp itself). The instance's own ceiling is normal — once you've
 * climbed the stairs, the space above your head here should read like any
 * other floor's, not like another open shaft.
 *
 * Like `stair_lower`, this type's own `h` (`STAIR_LANDING_HEIGHT_CELLS`)
 * only reaches down partway from this floor's baseline, not all the way to
 * `stair_lower`'s own wall below — see that type's doc comment and
 * `stairBuilder.ts`'s `buildShaftGuardWalls` for why the gap in between is
 * closed with separate, purpose-built geometry instead.
 */
const stairUpper: TileType = {
  id: "stair_upper",
  w: 3,
  d: 1,
  h: STAIR_LANDING_HEIGHT_CELLS,
  faces: {
    north: wallsOf(3),
    south: wallsOf(3),
    east: ["wall"],
    west: ["opening"],
  },
  skipFloorSlab: true,
};

export default stairUpper;
