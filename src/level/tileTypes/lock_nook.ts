import type { TileType } from "../tiles";
import { wallsOf } from "../tiles";

/**
 * A tiny 3m x 3m alcove (1x1 cell, 3m ceiling) — the training wing's
 * lockpicking-themed room (training wing task). Identical footprint/shape to
 * `nook.ts` (reused via rotation the exact same way `nook` is for the
 * upstairs wing's four small rooms), but with a **`"door"`** instead of an
 * `"opening"` on its one connecting face — the actual thing being "nodded
 * at" for lockpicking (`LockedDoorSpec`, `rooms/training-wing.ts`) needs a
 * real door to attach lock data to, which a plain `"opening"` (an archway,
 * no door entity at all) can't provide.
 *
 * Deliberately its **own** type rather than editing `nook.ts` in place: this
 * one connection needs to be a `"door"`, but `nook` already has four
 * existing instances (the upstairs wing's rooms) whose own connections are
 * all meant to stay plain, undecorated archways — editing `nook.ts` itself
 * would silently turn all four of those into hinged doors too (closed by
 * default, which would actually block those rooms' existing archways and
 * break `verticality-stairs.spec.mjs`'s traversal). A new type costs
 * nothing and keeps this one lockable door fully independent.
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
    south: ["door"],
    east: wallsOf(1),
    west: wallsOf(1),
  },
};

export default lockNook;
