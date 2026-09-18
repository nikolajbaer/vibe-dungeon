import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A small 6m x 6m side room (2x2 cells, unrotated) with a 3m ceiling — half
 * `great_hall`'s footprint and ceiling height, deliberately, so it reads as
 * a distinct kind of space (a cramped side chamber) rather than a smaller
 * copy of the great hall (issue #71). A single door sits on the near
 * (local z=0) segment of its west face; the far segment and the other two
 * faces are solid walls.
 *
 * (Training wing task) A second opening was added on the far (local z=1)
 * segment of the east face, branching the training wing off this room —
 * evolved in place rather than as a new type, since this type had exactly
 * one instance (`rooms/side-chamber.ts`'s own room) before this, the same
 * "safe to edit a type in place once it has a single instance" reasoning
 * `docs/LEVEL_DESIGN.md`'s worked examples use for `hallway_junction` ->
 * `hallway_cross`. `rooms/training-wing.ts`'s own corridor meets this
 * segment; see that file for the exact world cell this resolves to (world
 * x=18, z in [-3,0] — the room's north-east corner, clear of the existing
 * crate/lantern/backpack clutter which all sit further south).
 */
const sideChamber: TileType = {
  id: "side_chamber",
  w: 2,
  d: 2,
  h: 1,
  faces: {
    north: wallsOf(2),
    south: wallsOf(2),
    east: ["wall", "door"],
    west: ["door", "wall"],
  },
};

export default sideChamber;
