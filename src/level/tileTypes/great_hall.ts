import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A 9m x 9m room (3 wide x 3 deep, unrotated) with a 6m ceiling, with a
 * single door centered on the middle unit-cell segment of its south (long,
 * 3-wide) face — the other three faces are solid walls.
 */
const greatHall: TileType = {
  id: "great_hall",
  w: 3,
  d: 3,
  h: 2,
  faces: {
    north: wallsOf(3),
    south: ["wall", "door", "wall"],
    east: wallsOf(3),
    west: wallsOf(3),
  },
};

export default greatHall;
