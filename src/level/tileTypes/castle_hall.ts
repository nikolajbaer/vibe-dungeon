import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * The castle's great hall (great-hall wing task) — a proper feast hall, a
 * good deal bigger than `great_hall`/`great_hall_branch`: 12m x 18m (4 wide
 * x 6 deep, unrotated) with a 9m ceiling (`h: 3`, half again taller than
 * `great_hall`'s 6m), tall enough for its stained-glass windows and
 * freestanding columns to actually read as grand rather than just "a bigger
 * box." Four connection points, one per side, entrance/throne on the short
 * axis and the two side passages on the long one:
 *
 * - **north** (all 4 segments solid `"wall"`): the hall's presumed main
 *   entrance from outside the castle — nothing is built beyond this wall
 *   (there's no "outside the castle" in the level yet, and this is genuinely
 *   the map's own edge in this direction — see `rooms/castle-hall.ts`'s
 *   header comment for why that matters), so it can never be a real
 *   `"door"`/`"opening"` face (`validateOccupancy` rejects any open segment
 *   facing empty space). The oversized double doors implied by that entrance
 *   are instead a purely decorative fixture
 *   (`assets/furniture/grand-doors.ts`) mounted flush against this wall —
 *   see `rooms/castle-hall.ts` for the placement. "Locked at all times" in
 *   the sense that matters: there is no door component here at all to ever
 *   unlock.
 * - **south** (all 4 segments solid `"wall"`): the far wall the throne backs
 *   onto — a dead end architecturally, same reasoning as the north wall,
 *   just without even the decorative doors. (Also, unlike the north wall,
 *   this one genuinely does have something on its far side — the stairwell
 *   wing's corridor — which is exactly why the throne, not the entrance,
 *   backs onto it; see `rooms/castle-hall.ts`.)
 * - **east** (index 2 of 6, the segment at local z=2): the door back to
 *   `room-a` (the level's original starting room) — see `rooms/room-a.ts`,
 *   which reuses `great_hall_branch`'s existing west opening (rotation 0)
 *   for the other side of this same boundary.
 * - **west** (index 4 of 6, the segment at local z=4): the door into the
 *   Maester's study (`study.ts`/`rooms/castle-hall.ts`).
 *
 * Room-sized (`w,d > 1`), so it gets automatic wall torches like
 * `great_hall`/`training_hub` do, in addition to its own authored
 * candelabra/window/column decor.
 */
const castleHall: TileType = {
  id: "castle_hall",
  w: 4,
  d: 6,
  h: 3,
  faces: {
    north: wallsOf(4),
    south: wallsOf(4),
    east: ["wall", "wall", "door", "wall", "wall", "wall"],
    west: ["wall", "wall", "wall", "wall", "door", "wall"],
  },
};

export default castleHall;
