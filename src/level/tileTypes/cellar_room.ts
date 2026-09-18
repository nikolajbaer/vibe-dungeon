import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * The cellar's one room (cellar wing task) — a 6m x 6m room (2x2 cells,
 * matching `side_chamber`'s footprint/ceiling height), single door on its
 * local west face, near segment. Deliberately its **own** type rather than
 * reusing `side_chamber` directly: this level's asset-authoring system
 * shares a tile *type* (not just its shape) across every instance that
 * references it, so if a later change ever gives `side_chamber` a second
 * opening for some other feature, an instance of *this* room would silently
 * inherit it too — a new type with the exact same shape costs nothing and
 * keeps the cellar's one connection fully independent of whatever else
 * `side_chamber` is used for.
 *
 * See `rooms/cellar.ts` for why this is the *bottom* terminus of the new
 * downward staircase (its door meets `stair_lower`'s east-facing opening)
 * and for the room's own "dim, neglected" dressing — the room being small
 * and cramped (half `great_hall`'s footprint, same as `side_chamber`) is
 * itself part of that: this is meant to feel like the dungeon's forgotten
 * bottom, not another proper hall.
 */
const cellarRoom: TileType = {
  id: "cellar_room",
  w: 2,
  d: 2,
  h: 1,
  faces: {
    north: wallsOf(2),
    south: wallsOf(2),
    east: wallsOf(2),
    west: ["door", "wall"],
  },
};

export default cellarRoom;
