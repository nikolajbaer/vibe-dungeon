// Shared tile-type shape and helpers for the tile-based level format (issue
// #21). See README's "Tile-based level system" design notes for the
// authoritative spec: a 3m unit grid, tile types as a {w,d,h} footprint (in
// cells) plus a face map, and tile instances placing a type at a grid
// origin with a 90-degree-step rotation.
//
// This module only defines the *shape* every tile type conforms to, plus
// `wallsOf` — actual tile type definitions live one per file under
// `./tileTypes/`, auto-discovered by `./tileTypeRegistry.ts` (same
// auto-discovery pattern as `src/assets/itemRegistry.ts` — see that file's
// header comment for why: a new tile type means adding one new file, never
// editing a shared registry). Placement (tile *instances*), rotation, and
// the occupancy index live in occupancy.ts.

/** Size, in meters, of one grid cell along every axis (including height —
 * the grid is a uniform 3m cube, not just a 2D floor grid). */
export const UNIT = 3;

/**
 * Vertical rise, in meters, from one floor's baseline to the next (issue
 * #86 — multi-level/verticality support). A tile's own `h` still only sets
 * *ceiling* height above its own floor (see `TileType` below); this is the
 * separate, level-wide constant that says how far *up* floor N+1's baseline
 * sits above floor N's. Fixed at two grid cells (6m) rather than derived per
 * staircase, because every floor in this game shares one uniform rise —
 * there's no reason for two different staircases to climb by different
 * amounts, and a shared constant is what lets `sectorAt`'s Y->floor guess
 * (`floorForY` below) work without per-instance data.
 *
 * Deliberately matches `great_hall`'s existing `h=2` (6m) ceiling: a
 * player standing in the tallest room downstairs and a player standing on
 * the upper floor experience the same absolute scale, so nothing about the
 * new floor reads as "extra tall" or "extra short" relative to what's
 * already there.
 */
export const FLOOR_RISE = 2 * UNIT;

/**
 * How many grid cells tall a staircase landing's own wall segment reaches
 * above its own floor baseline — `stair_lower.ts`/`stair_upper.ts` both
 * declare `h: STAIR_LANDING_HEIGHT_CELLS` rather than a literal `1`, so
 * `stairBuilder.ts`'s `buildShaftGuardWalls` can compute exactly how much
 * of the shaft's total `FLOOR_RISE` those per-landing walls *don't* reach
 * (see that function's own doc comment for why that gap matters and why
 * it's filled separately rather than by just making the landings' own `h`
 * taller) without hardcoding a second copy of a number that would silently
 * drift out of sync with those two tile types' own declared height. */
export const STAIR_LANDING_HEIGHT_CELLS = 1;

/** World Y (meters) of floor `floor`'s baseline — the height at which that
 * floor's own `y≈0` conventions (its floor slab, its wall base, every prop/
 * item/NPC authored at `y: 0` on that floor) actually sit in world space.
 * Floor 0 (the original, only-ever-existed-until-now ground floor) is
 * baseline 0, exactly reproducing every existing room's untouched world
 * position — this is what makes `floor` an *additive* concept rather than a
 * breaking change to every already-authored `RoomContent`. */
export function floorBaseline(floor: number): number {
  return floor * FLOOR_RISE;
}

/**
 * The lowest floor actually built anywhere in the level today (the cellar,
 * one below the original ground floor — see `rooms/cellar.ts`). `floorForY`
 * below clamps to this as a defensive floor-of-floors, the same protective
 * spirit as this function's original `Math.max(0, ...)` clamp (see that
 * git history / the doc comment below for why 0 was never actually the
 * right thing to clamp to). Update this the day a floor deeper than -1
 * gets built — nothing else needs to change, since every consumer just
 * treats whatever `floorForY` returns as an opaque floor index.
 */
const MIN_FLOOR = -1;

/**
 * The inverse of `floorBaseline`, used where code only has a world Y (the
 * player's feet, an NPC's position) and needs to know which floor that
 * actually corresponds to — critically, *not* the same question as "which
 * XZ cell", since two floors can now legitimately share XZ space (a
 * staircase's landing sits at the same `(x, z)` on both floors it connects —
 * see `stair_lower.ts`/`stair_upper.ts`). Rounds to the nearest floor rather
 * than flooring, so a position anywhere in the upper half of one floor's
 * rise (e.g. partway up a staircase) already reads as "the floor above" —
 * harmless here because every vertical connection (see `StairConnector` in
 * `placementTypes.ts`) deliberately shares one `sectorId` between its two
 * landings, so which side of the rounding a mid-climb position falls on
 * doesn't change the answer sector tracking actually cares about.
 *
 * This used to also clamp the result to a minimum of 0, before any floor
 * below the ground floor existed. That clamp's own comment framed it as
 * jitter protection ("a momentary sub-baseline value... doesn't read as a
 * nonsensical negative floor") — but rounding-to-nearest already provides
 * that protection on its own, for *any* floor, not just floor 0: a `y` a
 * few centimeters either side of a floor's baseline is within `FLOOR_RISE /
 * 2` of it and rounds straight back to that floor, clamp or no clamp (e.g.
 * `y = -0.05` gives `round(-0.05 / 6) = round(-0.008) = 0` unaided). What
 * the old clamp actually did, as opposed to what its comment described, was
 * unconditionally forbid *any* negative floor at all — correct back when
 * floor -1 didn't exist (there was nothing else a deeply-negative `y` could
 * legitimately mean), wrong now that the cellar (`rooms/cellar.ts`) is a
 * real floor -1 a player can genuinely stand in, where the old clamp would
 * misreport every position there as floor 0.
 *
 * The fix is narrower than deleting the clamp outright: `Math.max` is kept,
 * just re-pointed at `MIN_FLOOR` (the lowest floor genuinely built today)
 * instead of a hardcoded 0, so a real floor -1 position still resolves
 * correctly while a wild physics glitch (a ragdoll clipping meters through
 * the cellar's own floor slab into never-built space below it) still can't
 * report a floor that doesn't exist — the same defensive purpose the
 * original clamp served, just recalibrated to where the level's own lowest
 * real floor actually is instead of assuming it's always 0. There's no
 * equivalent clamp on the *upper* end for the same reason there never was
 * one before this change: nothing currently relies on one, and adding a
 * `MAX_FLOOR` symmetrically would be speculative until an upper-floor
 * equivalent of this problem is ever actually observed.
 */
export function floorForY(y: number): number {
  return Math.max(MIN_FLOOR, Math.round(y / FLOOR_RISE));
}

/** What a single unit-cell-wide segment of a tile's perimeter is. Doors and
 * openings are always exactly one segment (never a whole multi-unit wall) —
 * enforced by the face map's shape (one entry per unit-cell segment), not
 * by a runtime check. */
export type FaceKind = "wall" | "opening" | "door";

/** The four perimeter sides of an *unrotated* tile footprint, named by the
 * local axis they face (local +z = north, +x = east — these are local-space
 * labels only; a rotated instance's "north" face may end up facing any
 * world direction, see occupancy.ts). */
export type Side = "north" | "south" | "east" | "west";

/**
 * A tile type: a footprint `w` (cells, local x) x `d` (cells, local z) x `h`
 * (cells, height — sets ceiling height only; see README "Floors stay at a
 * single baseline for v1"), plus a face map describing every unit-cell
 * segment around the perimeter, unrotated.
 *
 * `faces.north` / `faces.south` have length `w` (indexed by local x,
 * increasing). `faces.east` / `faces.west` have length `d` (indexed by
 * local z, increasing).
 */
export interface TileType {
  id: string;
  w: number;
  d: number;
  h: number;
  faces: Record<Side, FaceKind[]>;
  /** Skips this type's usual automatic floor slab (`buildGeometryFromOccupancy`
   * in `tileBuilder.ts` builds one per instance, spanning its footprint at
   * its floor's baseline) — for a tile instance that sits directly *above* a
   * vertical shaft (a staircase's upper landing, see `stair_upper.ts`) and
   * whose "floor" is really whatever's structurally underneath it (riser
   * geometry, see `stairBuilder.ts`) rather than a poured slab. Almost every
   * type wants the default (a real floor); leave this unset unless a type is
   * specifically the top terminus of a vertical connection. */
  skipFloorSlab?: boolean;
  /** Skips this type's usual automatic ceiling slab, the mirror of
   * `skipFloorSlab` — for a tile instance that a vertical shaft continues
   * *up through* (a staircase's lower landing, see `stair_lower.ts`), where
   * a normal ceiling would seal the player inside instead of letting them
   * climb into the floor above. */
  skipCeilingSlab?: boolean;
}

/** Builds an all-`"wall"` face-map entry of the given length — most tile
 * types' non-connecting sides are just this. */
export function wallsOf(length: number): FaceKind[] {
  return Array.from({ length }, () => "wall" as const);
}
