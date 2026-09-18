import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A small 6m x 6m room (2x2 cells, unrotated) with a 3m ceiling and exactly
 * one door, on the near (local z=0) segment of its west face — the training
 * wing's melee/ranged/equipment rooms (training wing task).
 *
 * This is deliberately its own type rather than reusing `side_chamber`
 * (identical footprint/ceiling/door position): `side_chamber` picked up a
 * *second* opening (training wing task) for its own room's branch into this
 * wing, and a tile type's face map is shared by every instance that
 * references it — reusing `side_chamber` here would silently give each of
 * these three single-door rooms `side_chamber`'s second opening too, with
 * nothing on the other side of it (a real failure caught immediately by
 * `validateOccupancy` — this is exactly that mistake, made and reverted
 * while building this wing). `small_room` is what `side_chamber` looked
 * like *before* that second opening was added — a plain single-door 2x2
 * room, reusable via rotation the same way `side_chamber`/`great_hall` are.
 */
const smallRoom: TileType = {
  id: "small_room",
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

export default smallRoom;
