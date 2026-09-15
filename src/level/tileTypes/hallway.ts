import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A single 3m x 9m corridor segment (3m ceiling), open at both ends
 * (north/south, before rotation). Chain several instances to form a longer
 * corridor, or rotate a single instance 90 degrees to run it east-west
 * instead.
 */
const hallway: TileType = {
  id: "hallway",
  w: 1,
  d: 3,
  h: 1,
  faces: {
    north: ["opening"],
    south: ["opening"],
    east: wallsOf(3),
    west: wallsOf(3),
  },
};

export default hallway;
