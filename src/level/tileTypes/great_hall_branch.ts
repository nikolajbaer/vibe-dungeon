import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A `great_hall` variant with one extra opening on its local **west** face,
 * middle segment — originally added so `room-b` (see `rooms/room-b.ts`)
 * could branch the downward cellar staircase off it (cellar wing task)
 * without touching plain `great_hall`, which `room-a` used unmodified at the
 * time.
 *
 * This is the same technique `docs/LEVEL_DESIGN.md`'s "worked example"
 * section describes for `hallway` -> `hallway_junction`: a new type that's a
 * strict superset of the old one's openings (same footprint, same existing
 * door, plus one more opening). `room-b` places it at `rotation: 180`; local
 * west maps to world **east** at that rotation (see `rooms/room-b.ts`'s own
 * header comment on how 180 degrees swaps local east/west), landing the
 * opening on room-b's east wall, well clear of its shrine/barrel decor.
 *
 * `room-a` (great-hall wing task) now uses this same type too, at
 * `rotation: 0` — local west stays world west unrotated, landing a matching
 * opening on room-a's own west wall for the new passage into `castle_hall`
 * (see `rooms/room-a.ts` and `rooms/castle-hall.ts`). Plain `great_hall` has
 * no other users left as of that change and was retired outright (same "one
 * evolved type, not a strictly-narrower type left lying around as dead code"
 * reasoning `hallway_junction` got when `hallway_cross` superseded it — see
 * that type's own doc comment) — this one type now covers both of
 * `great_hall`'s two former instances, one per rotation.
 */
const greatHallBranch: TileType = {
  id: "great_hall_branch",
  w: 3,
  d: 3,
  h: 2,
  faces: {
    north: wallsOf(3),
    south: ["wall", "door", "wall"],
    east: wallsOf(3),
    west: ["wall", "opening", "wall"],
  },
};

export default greatHallBranch;
