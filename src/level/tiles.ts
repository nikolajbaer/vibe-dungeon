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
}

/** Builds an all-`"wall"` face-map entry of the given length — most tile
 * types' non-connecting sides are just this. */
export function wallsOf(length: number): FaceKind[] {
  return Array.from({ length }, () => "wall" as const);
}
