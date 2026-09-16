import type { TileType } from "../tiles";

/**
 * The upstairs landing hub (issue #86) — a 6m x 6m room (2x2 cells, matching
 * `side_chamber`'s footprint, so it's room-sized and gets torches
 * automatically) with **five** connection points spread across its four
 * faces: one to the staircase (`stair_upper`, see `rooms/stairwell.ts`) and
 * one to each of the level's four new small upstairs rooms (`nook`,
 * reused via rotation for each). A 2x2 footprint gives each side face two
 * independent unit-cell segments (see README's "Doors/openings are always
 * centered on a single unit-cell face" rule) — this type only needs 5 of
 * the 8 available segments, spread as:
 *
 * - **east** (index 1, the segment nearer -z): opens to the staircase.
 * - **west** (both segments): opens to two rooms, stacked along z.
 * - **north** (index 0, the segment nearer -x): opens to one room.
 * - **south** (index 0, the segment nearer -x): opens to one room.
 *
 * The remaining 3 segments (east index 0, north/south index 1) stay solid
 * wall — this is a landing with five doorways, not a fully-open room, which
 * reads better for a "small, distinct spaces" upstairs area than one big
 * open floor plan would (see docs/LEVEL_DESIGN.md's design pillars).
 */
const upperLanding: TileType = {
  id: "upper_landing",
  w: 2,
  d: 2,
  h: 1,
  faces: {
    // Indexed by local x (0, 1) — see tiles.ts's face-map doc comment.
    south: ["opening", "wall"],
    north: ["opening", "wall"],
    // Indexed by local z (0, 1).
    east: ["wall", "opening"],
    west: ["opening", "opening"],
  },
};

export default upperLanding;
