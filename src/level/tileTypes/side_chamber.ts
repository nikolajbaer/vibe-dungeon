import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A small 6m x 6m side room (2x2 cells, unrotated) with a 3m ceiling — half
 * `great_hall`'s footprint and ceiling height, deliberately, so it reads as
 * a distinct kind of space (a cramped side chamber) rather than a smaller
 * copy of the great hall (issue #71). A single door sits on the near
 * (local z=0) segment of its west face; the far segment and the other three
 * faces are solid walls, so this type has exactly one connection point.
 */
const sideChamber: TileType = {
  id: "side_chamber",
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

export default sideChamber;
