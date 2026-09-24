import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A minimal 3m x 3m room (1x1 cell, 3m ceiling) with a single door on its
 * local south face — the smallest thing that still counts as a "room"
 * rather than a closet. Introduced (issue #86) for the small upstairs rooms
 * fanning out from `upper_landing`/the dormitory wing's corridors, reused
 * via rotation exactly like `great_hall` is for `room-a`/`room-b` (see
 * docs/LEVEL_DESIGN.md's "How rotation works") rather than a near-duplicate
 * one-off type per room — a rotation-90 `nook` opens east, 180 opens north,
 * 270 opens west (the standard CCW rotation table any single-face type
 * follows).
 *
 * That one connecting face is a `"singleDoor"` (dormitory-expansion task),
 * not a bare `"opening"` — a real, closeable, human-scale door rather than
 * an archway with no door entity at all, per the "use a single door
 * wherever a smaller room is on the other side" convention (see
 * `tileBuilder.ts`'s `addSingleDoor`). It was a plain `"opening"` until
 * this task; every existing instance (the dormitory's rooms) picked up a
 * real door for free as a result, which is the intended retrofit, not a
 * side effect to work around.
 *
 * Deliberately smaller even than `side_chamber` (half its footprint) so
 * these read as small, distinct little rooms off a hub/corridor rather than
 * more side chambers — being 1x1 also means none of them qualify for
 * automatic torches (`isRoomSizedTileType` requires `w > 1 && d > 1`), which
 * is fine: they're meant to be quiet, and the room-sized spaces they open
 * onto already carry the light.
 */
const nook: TileType = {
  id: "nook",
  w: 1,
  d: 1,
  h: 1,
  faces: {
    north: wallsOf(1),
    south: ["singleDoor"],
    east: wallsOf(1),
    west: wallsOf(1),
  },
};

export default nook;
