import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A 3m x 12m dormitory corridor (1x4 cells, 3m ceiling, unrotated) — the
 * dormitory-expansion task's spine for the four bedrooms fanning off one
 * side. Open at both ends (`north`/`south`, matching `hallway.ts`'s own
 * "chain instances, or rotate 90 to run it the other way" shape) so it can
 * sit between `upper_landing`'s own hub and a capping `nook`-reused latrine
 * (see `rooms/stairwell.ts`) — both ends declare a plain `"opening"`, so
 * which literal world direction each end actually faces doesn't matter,
 * only that whatever's beyond it agrees on open-vs-wall.
 *
 * Unlike `hallway`, this isn't just a through-passage: its **west** face has
 * one `"singleDoor"` per cell (four total, one per bedroom) — a real,
 * human-scale door into each room off this stretch of corridor, not a bare
 * archway (see `nook.ts`'s own doc comment for why `"singleDoor"`, not
 * `"opening"` or a full double `"door"`, is the right fit for a bedroom this
 * small). The **east** face stays solid the whole length — every bedroom in
 * this wing opens off the corridor's west side only, per the task's own
 * layout ("4 rooms... with rooms on the west side").
 *
 * `w = 1` (a corridor, never room-sized — `isRoomSizedTileType` requires
 * `w > 1 && d > 1`) means this never gets automatic torches; see
 * `rooms/stairwell.ts` for the manual candelabras that light it instead.
 */
const dormCorridor: TileType = {
  id: "dorm_corridor",
  w: 1,
  d: 4,
  h: 1,
  faces: {
    // Indexed by local x (0) -- a single segment each, the corridor's width.
    north: ["opening"],
    south: ["opening"],
    // Indexed by local z (0..3, increasing) -- one door per bedroom.
    east: wallsOf(4),
    west: ["singleDoor", "singleDoor", "singleDoor", "singleDoor"],
  },
};

export default dormCorridor;
