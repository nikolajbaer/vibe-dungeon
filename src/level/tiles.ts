// Tile-type definitions for the tile-based level format (issue #21). See
// README's "Tile-based level system" design notes for the authoritative
// spec: a 3m unit grid, tile types as a {w,d,h} footprint (in cells) plus a
// face map, and tile instances placing a type at a grid origin with a
// 90-degree-step rotation. This module only defines *types*; placement,
// rotation, and the occupancy index live in occupancy.ts.

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

function wallsOf(length: number): FaceKind[] {
  return Array.from({ length }, () => "wall" as const);
}

/**
 * A single 3m x 3m x 9m corridor segment, open at both ends (north/south,
 * before rotation). Chain several instances to form a longer corridor, or
 * rotate a single instance 90 degrees to run it east-west instead.
 */
export const HALLWAY: TileType = {
  id: "hallway",
  w: 1,
  d: 1,
  h: 3,
  faces: {
    north: ["opening"],
    south: ["opening"],
    east: ["wall"],
    west: ["wall"],
  },
};

/**
 * A 9m x 6m room (3 wide x 2 deep, unrotated) with a single door centered on
 * the middle unit-cell segment of its south (long, 3-wide) face — the other
 * three faces are solid walls.
 */
export const GREAT_HALL: TileType = {
  id: "great_hall",
  w: 3,
  d: 2,
  h: 3,
  faces: {
    north: wallsOf(3),
    south: ["wall", "door", "wall"],
    east: wallsOf(2),
    west: wallsOf(2),
  },
};

export const TILE_TYPES: Record<string, TileType> = {
  [HALLWAY.id]: HALLWAY,
  [GREAT_HALL.id]: GREAT_HALL,
};
