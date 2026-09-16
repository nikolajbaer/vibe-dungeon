import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A minimal 3m x 3m room (1x1 cell, 3m ceiling) with a single opening on its
 * local south face — the smallest thing that still counts as a "room"
 * rather than a closet. Introduced (issue #86) for the four small upstairs
 * rooms fanning out from `upper_landing`, one per compass direction, reused
 * via rotation exactly like `great_hall` is for `room-a`/`room-b` (see
 * docs/LEVEL_DESIGN.md's "How rotation works") rather than four
 * near-duplicate one-off types — a rotation-90 `nook` opens east, 180 opens
 * north, 270 opens west (the standard CCW rotation table any single-face
 * type follows).
 *
 * Deliberately smaller even than `side_chamber` (half its footprint) so the
 * four of these read as small, distinct little rooms off a landing rather
 * than four more side chambers — being 1x1 also means none of them qualify
 * for automatic torches (`isRoomSizedTileType` requires `w > 1 && d > 1`),
 * which is fine: they're meant to be quiet, and `upper_landing` itself
 * (2x2, room-sized) already lights the hub they all open onto.
 */
const nook: TileType = {
  id: "nook",
  w: 1,
  d: 1,
  h: 1,
  faces: {
    north: wallsOf(1),
    south: ["opening"],
    east: wallsOf(1),
    west: wallsOf(1),
  },
};

export default nook;
