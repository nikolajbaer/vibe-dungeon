import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A `great_hall` variant with one extra opening on its local **west** face,
 * middle segment — used only by `room-b` (see `rooms/room-b.ts`), to branch
 * the new downward cellar staircase off it (cellar wing task) without
 * touching `great_hall` itself, which `room-a` also uses unmodified.
 *
 * This is the same technique `docs/LEVEL_DESIGN.md`'s "worked example"
 * section describes for `hallway` -> `hallway_junction`: a new type that's a
 * strict superset of the old one's openings (same footprint, same existing
 * door, plus one more opening), with only the *one* instance that needs the
 * extra connection (`room-b`) swapped onto it — `room-a` keeps using
 * `great_hall` untouched, so its own solid west wall is completely
 * unaffected. Unlike the `hallway`/`hallway_junction` case, `great_hall` has
 * *two* instances (`room-a` and `room-b`), which is exactly why this can't
 * be an in-place edit to `great_hall.ts` the way `nook`-adjacent retrofits
 * sometimes are for a type with only one instance — editing the shared type
 * would silently add the same opening to `room-a` too, and `room-a`'s local
 * west face has nothing behind it, which `validateOccupancy` would (rightly)
 * reject as an opening facing empty space.
 *
 * Room-b places this type at `rotation: 180`; local west maps to world
 * **east** at that rotation (see `rooms/room-b.ts`'s own header comment on
 * how 180 degrees swaps local east/west), landing the new opening on
 * room-b's east wall, well clear of its existing shrine/barrel decor (see
 * that file for the exact world cell this resolves to).
 */
const greatHallBranch: TileType = {
  id: "great_hall_branch",
  w: 3,
  d: 3,
  h: 2,
  faces: {
    north: wallsOf(3),
    south: ["wall", "door", "wall"],
    east: wallsOf(3),
    west: ["wall", "opening", "wall"],
  },
};

export default greatHallBranch;
