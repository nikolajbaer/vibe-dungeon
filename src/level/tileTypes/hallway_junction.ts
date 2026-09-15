import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A T-junction variant of `hallway` (issue #71): the same 3m x 9m footprint
 * and the same north/south openings (so it's a strict superset of
 * `hallway`'s connections — anything already plugged into a hallway's ends
 * still fits), plus one more opening on the middle segment of its east face.
 * Used to retrofit an existing straight corridor into a branch point without
 * moving it — swap the instance's `tileTypeId` from `"hallway"` to
 * `"hallway_junction"` and leave `originCell`/`rotation` untouched (see
 * docs/LEVEL_DESIGN.md's "current limitation" and "worked example" sections
 * for why a face-map change, not a new instance, is what branching off an
 * existing hallway actually requires).
 */
const hallwayJunction: TileType = {
  id: "hallway_junction",
  w: 1,
  d: 3,
  h: 1,
  faces: {
    north: ["opening"],
    south: ["opening"],
    east: ["wall", "opening", "wall"],
    west: wallsOf(3),
  },
};

export default hallwayJunction;
