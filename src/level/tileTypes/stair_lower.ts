import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * The lower (ground-floor) terminus of a staircase (issue #86) — a 3m x 9m
 * footprint (3 cells long, 1 wide — see `stairBuilder.ts`'s `STAIR_RUN_CELLS`
 * for why 3, not fewer: it's what keeps the ramp collider underneath a
 * comfortable margin below the character controller's max climb angle),
 * open only on its **east** end (the corridor-facing entrance; see
 * `rooms/stairwell.ts`), walled everywhere else. Always paired with a
 * `stair_upper` instance at the *same* `originCell`, one floor up (see
 * `TileInstance.floor`'s doc comment on why that's not an overlap) — the
 * pairing is completed by a `StairConnector` (`placementTypes.ts`) in the
 * room file that places both, which is what actually builds the climbable
 * ramp geometry between them (`stairBuilder.ts`).
 *
 * `skipCeilingSlab` is one load-bearing part of this type: without it,
 * `buildGeometryFromOccupancy` would cap this instance with a normal
 * ceiling slab at its own `h`, sealing the shaft shut a few feet up instead
 * of leaving it open all the way through to the floor above (see
 * `TileType.skipCeilingSlab`'s doc comment in `tiles.ts`).
 *
 * `skipFloorSlab` is the other one, and easy to miss: this instance's own
 * *footprint* is exactly the staircase's run (all three grid cells — see
 * `rooms/stairwell.ts`'s `StairConnector`), so the real walking surface
 * across it is the ramp geometry `stairBuilder.ts` builds, not a flat slab.
 * Leaving the normal floor slab in place here (an early version of this
 * type did, back when climbing was meant to be stepped-riser autostep
 * rather than a ramp) put a flat floor at y=0 directly underneath/
 * overlapping the step geometry for the whole run — confirmed, by an actual
 * Playwright walk-up, to jam the character controller solid right at the
 * shaft entrance.
 */
const stairLower: TileType = {
  id: "stair_lower",
  w: 3,
  d: 1,
  h: 1,
  faces: {
    north: wallsOf(3),
    south: wallsOf(3),
    east: ["opening"],
    west: ["wall"],
  },
  skipCeilingSlab: true,
  skipFloorSlab: true,
};

export default stairLower;
