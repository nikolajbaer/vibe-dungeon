import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A small 6m x 9m study (2 wide x 3 deep, unrotated) with a 3m ceiling —
 * half `castle_hall`'s footprint/height, the same "distinct kind of space"
 * scaling `side_chamber` uses relative to `great_hall` (see that type's own
 * doc comment). Its only opening is a single door on the middle segment of
 * its east (long) face, into `castle_hall`'s own west door — see
 * `rooms/castle-hall.ts` for the exact cell math. The other three faces are
 * solid walls; the study's own smaller windows (unlike the hall's large
 * stained-glass ones) are purely decorative fixtures mounted on those walls,
 * not real openings.
 */
const study: TileType = {
  id: "study",
  w: 2,
  d: 3,
  h: 1,
  faces: {
    north: wallsOf(2),
    south: wallsOf(2),
    east: ["wall", "door", "wall"],
    west: wallsOf(3),
  },
};

export default study;
