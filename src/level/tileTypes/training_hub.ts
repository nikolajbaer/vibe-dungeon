import type { TileType } from "../tiles";

/**
 * The training wing's central hub (training wing task) — a 9m x 9m room
 * (3x3 cells, matching `great_hall`'s footprint/ceiling height, so it reads
 * like a proper hall rather than a corridor junction) with **five**
 * connection points: one back to the entry corridor, and one to each of the
 * wing's four training rooms.
 *
 * A 3x3 footprint gives each side face three independent unit-cell segments
 * (see README's "doors/openings are always centered on a single unit-cell
 * face" rule) — this type only needs 5 of the 12 available segments:
 *
 * - **west** (index 1, the middle segment): opens back to the entry
 *   corridor (`rooms/training-wing.ts`'s `training-corridor`).
 * - **north** (index 1, middle): opens to the melee training room.
 * - **south** (index 1, middle): opens to the ranged training room.
 * - **east** (index 0, the segment nearer -z): opens to the equipment room.
 * - **east** (index 2, the segment nearer +z): opens to the lockpicking
 *   nook. Both east segments are used (with the middle, index 1, left
 *   solid) so the two east-side rooms have a full cell of solid wall
 *   between their footprints rather than needing to interleave — see
 *   `rooms/training-wing.ts` for the exact cell math.
 *
 * The remaining 7 segments stay solid wall. Room-sized (`w,d > 1`), so it
 * gets automatic torches like `great_hall`/`upper_landing` do.
 */
const trainingHub: TileType = {
  id: "training_hub",
  w: 3,
  d: 3,
  h: 2,
  faces: {
    // Indexed by local x (0, 1, 2).
    north: ["wall", "opening", "wall"],
    south: ["wall", "opening", "wall"],
    // Indexed by local z (0, 1, 2).
    east: ["opening", "wall", "opening"],
    west: ["wall", "opening", "wall"],
  },
};

export default trainingHub;
