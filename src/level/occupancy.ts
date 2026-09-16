// Rotation math, the tile occupancy index, and the load-time level linter
// for the tile-based level format (issue #21). Deliberately framework-free
// (no three.js/bitecs imports) so it can be exercised directly (see the
// verification notes in the PR) and reused by a future level editor (#14)
// without dragging in rendering/ECS dependencies.

import type { FaceKind, TileType } from "./tiles";
import { floorForY } from "./tiles";
import { TILE_TYPES } from "./tileTypeRegistry";

export type Rotation = 0 | 90 | 180 | 270;

/** A tile placed in the world: a type, a grid origin (the min-corner cell
 * of its footprint *after* rotation is applied), a rotation, and an
 * author-assigned sector id (see README "Sectors" — tracking data only). */
export interface TileInstance {
  id: string;
  tileTypeId: string;
  originCell: { x: number; z: number };
  rotation: Rotation;
  sectorId: string;
  /** Which floor this instance sits on — 0 (the default, and the only value
   * that existed before issue #86) is the original ground level;
   * `floorBaseline(floor)` (`tiles.ts`) is the world Y this instance's own
   * `y≈0` conventions (its floor slab, its wall base) actually sit at.
   * Omitted on every pre-existing `RoomContent` file, which is exactly the
   * point — `floor` is additive, and every room authored before this field
   * existed keeps rendering at the same world position it always did.
   *
   * Two instances can now legitimately share an `(x, z)` cell as long as
   * they're on different floors (a staircase's lower and upper landing sit
   * at the *same* cell on floors that differ by one — see
   * `stair_lower.ts`/`stair_upper.ts`) — see `worldCellKey` below for how
   * the occupancy index's key folds `floor` in specifically to make that
   * not collide with the overlap check. */
  floor?: number;
}

/** Per-cell face kinds, using world-axis-aligned labels (negX/posX/negZ/
 * posZ) rather than the tile-type's local north/south/east/west — rotation
 * has already been applied by the time a CellSides exists. `null` means
 * "interior to this tile instance" (another cell of the same instance is on
 * that side, so there's no wall there at all). */
interface CellSides {
  negX: FaceKind | null;
  posX: FaceKind | null;
  negZ: FaceKind | null;
  posZ: FaceKind | null;
}

interface LocalFootprint {
  w: number;
  d: number;
  cells: Map<string, CellSides>;
}

/** Key for the *local*, per-footprint cell map (`LocalFootprint.cells`) used
 * while rotating a single instance's own footprint — always just an XZ pair,
 * never floor-aware, since rotation is worked out entirely in an instance's
 * own local space before it's ever placed at a world origin or a floor (see
 * `unrotatedFootprint`/`rotateOnce` below). Not to be confused with
 * `worldCellKey`, the floor-aware key the *occupancy index* (world cells
 * across the whole level) actually uses. */
function cellKey(x: number, z: number): string {
  return `${x},${z}`;
}

/** Key for the world occupancy index: `(x, z, floor)`. Folding `floor` in
 * here — rather than keying by `(x, z)` alone, as this level format did
 * before floors existed — is the specific change that lets two tile
 * instances legitimately claim the same XZ cell as long as they're on
 * different floors (see `TileInstance.floor`'s doc comment) without
 * `buildOccupancyIndex`'s overlap check below treating that as the same
 * "two instances fighting over one cell" error it correctly throws on
 * within a single floor. */
export function worldCellKey(x: number, z: number, floor: number): string {
  return `${x},${z},${floor}`;
}

/** The inverse of `worldCellKey` — every consumer of `OccupancyIndex` that
 * needs to recover a cell's world coordinates from its map key (wall/floor/
 * ceiling emission in `tileBuilder.ts`, the level viewer's sector overlay)
 * should use this rather than hand-rolling `key.split(",")`, so the key
 * format only has one authoritative parser. */
export function parseWorldCellKey(key: string): { x: number; z: number; floor: number } {
  const [x, z, floor] = key.split(",").map(Number);
  return { x, z, floor };
}

function unrotatedFootprint(type: TileType): LocalFootprint {
  const cells = new Map<string, CellSides>();
  for (let x = 0; x < type.w; x++) {
    for (let z = 0; z < type.d; z++) {
      cells.set(cellKey(x, z), {
        negX: x === 0 ? type.faces.west[z] : null,
        posX: x === type.w - 1 ? type.faces.east[z] : null,
        negZ: z === 0 ? type.faces.south[x] : null,
        posZ: z === type.d - 1 ? type.faces.north[x] : null,
      });
    }
  }
  return { w: type.w, d: type.d, cells };
}

/**
 * One 90-degree rotation step (counter-clockwise looking down +Y): turns a
 * w x d footprint into a d x w one, carrying each cell's side labels around
 * with it. Derived from rotating both cell coordinates and each side's
 * outward normal by 90 degrees: negX->negZ, posX->posZ, negZ->posX,
 * posZ->negX (i.e. the value that *was* on a cell's posZ side ends up on
 * its negX side after the step, etc).
 */
function rotateOnce(footprint: LocalFootprint): LocalFootprint {
  const cells = new Map<string, CellSides>();
  for (const [key, sides] of footprint.cells) {
    const [x, z] = key.split(",").map(Number);
    const nx = footprint.d - 1 - z;
    const nz = x;
    cells.set(cellKey(nx, nz), {
      negZ: sides.negX,
      posZ: sides.posX,
      posX: sides.negZ,
      negX: sides.posZ,
    });
  }
  return { w: footprint.d, d: footprint.w, cells };
}

function rotatedFootprint(type: TileType, rotation: Rotation): LocalFootprint {
  let footprint = unrotatedFootprint(type);
  const steps = (((rotation / 90) % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) footprint = rotateOnce(footprint);
  return footprint;
}

export interface OccupiedCell {
  instanceId: string;
  sectorId: string;
  tileTypeId: string;
  /** The owning instance's height, in cells — sets this cell's ceiling. */
  heightCells: number;
  /** Which floor this cell's owning instance is on — see `TileInstance.floor`.
   * `tileBuilder.ts` uses this to place this cell's floor/ceiling/walls at
   * the right world Y (`floorBaseline(floor)`), and `sectorAt` below uses it
   * (recovered from the player's Y via `floorForY`, not from XZ) to pick the
   * right floor's cell when two floors share an XZ column. */
  floor: number;
  sides: CellSides;
}

export type OccupancyIndex = Map<string, OccupiedCell>;

/**
 * Builds the cell -> tile-instance occupancy index described in the design
 * notes: O(1) "what tile is here / what's adjacent" lookups, keyed by
 * `"x,z"` world cell coordinates. Throws if two instances claim the same
 * cell — a level-authoring error in the same family as the face-mismatch
 * check below.
 */
export function buildOccupancyIndex(
  instances: readonly TileInstance[],
  tileTypes: Record<string, TileType> = TILE_TYPES,
): OccupancyIndex {
  const index: OccupancyIndex = new Map();
  for (const instance of instances) {
    const type = tileTypes[instance.tileTypeId];
    if (!type) {
      throw new Error(
        `Level error: tile instance "${instance.id}" references unknown tile type "${instance.tileTypeId}".`,
      );
    }
    const floor = instance.floor ?? 0;
    const footprint = rotatedFootprint(type, instance.rotation);
    for (const [key, sides] of footprint.cells) {
      const [lx, lz] = key.split(",").map(Number);
      const worldKey = worldCellKey(instance.originCell.x + lx, instance.originCell.z + lz, floor);
      if (index.has(worldKey)) {
        throw new Error(
          `Level error: tile instance "${instance.id}" overlaps another instance at cell (${worldKey}).`,
        );
      }
      index.set(worldKey, {
        instanceId: instance.id,
        sectorId: instance.sectorId,
        tileTypeId: instance.tileTypeId,
        heightCells: type.h,
        floor,
        sides,
      });
    }
  }
  return index;
}

/** "opening" and "door" both count as open for adjacency purposes — README:
 * "both open, or both wall". */
function isOpen(kind: FaceKind): boolean {
  return kind !== "wall";
}

const NEIGHBOR_DIRS: Array<{
  label: string;
  dx: number;
  dz: number;
  mine: keyof CellSides;
  theirs: keyof CellSides;
}> = [
  { label: "+x", dx: 1, dz: 0, mine: "posX", theirs: "negX" },
  { label: "-x", dx: -1, dz: 0, mine: "negX", theirs: "posX" },
  { label: "+z", dx: 0, dz: 1, mine: "posZ", theirs: "negZ" },
  { label: "-z", dx: 0, dz: -1, mine: "negZ", theirs: "posZ" },
];

/**
 * Load-time level linter (issue #21): validates that every pair of adjacent
 * tile instances agrees at their shared face — both walls, or both open —
 * and that no opening/door faces empty space. Throws a descriptive `Error`
 * on the first mismatch found, so a level author gets a clear message
 * instead of a silent visual/collision glitch.
 */
export function validateOccupancy(index: OccupancyIndex): void {
  for (const [key, cell] of index) {
    const { x, z } = parseWorldCellKey(key);
    for (const dir of NEIGHBOR_DIRS) {
      const kind = cell.sides[dir.mine];
      if (kind === null) continue; // interior to this tile instance

      // Adjacency is checked only *within* a floor — a face map has no
      // up/down direction at all (see `Side` in tiles.ts: north/south/east/
      // west only), so there is nothing here for a vertical connection
      // (a staircase) to validate against. That's a deliberate scope limit,
      // not an oversight: `StairConnector` (placementTypes.ts) is what
      // actually links two floors, and it's plain geometry-placement data
      // with no face-map concept to check face-for-face the way a
      // same-floor neighbor does.
      const neighborKey = worldCellKey(x + dir.dx, z + dir.dz, cell.floor);
      const neighbor = index.get(neighborKey);
      if (!neighbor) {
        if (kind !== "wall") {
          throw new Error(
            `Level validation error: cell (${x}, ${z}) [instance "${cell.instanceId}"] has a "${kind}" ` +
              `facing ${dir.label} into empty space — openings and doors must connect to another tile.`,
          );
        }
        continue;
      }

      const theirKind = neighbor.sides[dir.theirs];
      if (theirKind === null) {
        throw new Error(
          `Level validation error: cell (${x}, ${z}) [instance "${cell.instanceId}"] faces ${dir.label} into ` +
            `an interior side of instance "${neighbor.instanceId}" — footprints don't line up.`,
        );
      }
      if (isOpen(kind) !== isOpen(theirKind)) {
        throw new Error(
          `Level validation error: face mismatch at cell (${x}, ${z}) facing ${dir.label} — ` +
            `instance "${cell.instanceId}" has "${kind}" but instance "${neighbor.instanceId}" has "${theirKind}" ` +
            `on the shared face. Both sides must be walls, or both open (opening/door).`,
        );
      }
    }
  }
}

/**
 * Looks up the sector containing a world position, or `undefined` if it
 * isn't inside any placed tile. Per the design notes this is
 * authoring/tracking data only — nothing gates simulation on it.
 *
 * Takes `worldY` now (issue #86) and derives which *floor* to look up via
 * `floorForY`, not just XZ — once two floors can share an XZ column (a
 * staircase's two landings, see `stair_lower.ts`/`stair_upper.ts`), an XZ-only
 * lookup could resolve to either floor's cell arbitrarily (whichever
 * happened to be inserted into the map — order isn't meaningful here) and
 * would garble sector tracking for anyone standing above/below another
 * occupied cell. Reading the player's actual height and rounding it to the
 * nearest floor (see `floorForY`'s doc comment on why "nearest", not
 * "floor()") answers "which floor is this position actually on" the same
 * way a person would, rather than trusting XZ alone.
 */
export function sectorAt(index: OccupancyIndex, worldX: number, worldY: number, worldZ: number, unit: number): string | undefined {
  const cellX = Math.floor(worldX / unit);
  const cellZ = Math.floor(worldZ / unit);
  const floor = floorForY(worldY);
  return index.get(worldCellKey(cellX, cellZ, floor))?.sectorId;
}
