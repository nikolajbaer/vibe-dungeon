import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A tiny 3m x 3m alcove (1x1 cell, 3m ceiling) — the training wing's
 * lockpicking-themed room (training wing task). Identical footprint/shape to
 * `nook.ts` (reused via rotation the exact same way `nook` is for its own
 * small rooms), but its own type rather than sharing `nook` outright: this
 * one connection needs `LockedDoorSpec` (`rooms/training-wing.ts`) able to
 * attach lock data to it independent of `nook`'s own (unlocked) instances —
 * sharing a type would mean every instance sharing this one's lock data too,
 * which `LockedDoorSpec` addresses per (cell, side) precisely because a face
 * map has no per-instance override (see docs/LEVEL_DESIGN.md's "Current
 * limitation").
 *
 * Uses `"singleDoor"` (dormitory-expansion task, same as `nook`'s own single
 * connecting face) rather than a full double `"door"` — a 3m x 3m alcove is
 * exactly the "smaller room" case a single door fits, and a grand
 * double-leaf door here always looked oversized for what it was gating.
 * `Door.locked`/`requiredItemTypeId` work identically either way (see
 * `tileBuilder.ts`'s `addSingleDoor`'s `requiredItemTypeId` parameter) — the
 * lock mechanic doesn't care which door style built the leaf.
 *
 * Follows the same rotation table `nook.ts` documents (0=south, 90=east,
 * 180=north, 270=west), since the underlying rotation math only cares about
 * the footprint shape, not the `FaceKind` value it carries.
 */
const lockNook: TileType = {
  id: "lock_nook",
  w: 1,
  d: 1,
  h: 1,
  faces: {
    north: wallsOf(1),
    south: ["singleDoor"],
    east: wallsOf(1),
    west: wallsOf(1),
  },
};

export default lockNook;
