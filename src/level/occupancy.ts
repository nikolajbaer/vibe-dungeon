// Rotation math, the tile occupancy index, and the load-time level linter
// for the tile-based level format (issue #21). Deliberately framework-free
// (no three.js/bitecs imports) so it can be exercised directly (see the
// verification notes in the PR) and reused by a future level editor (#14)
// without dragging in rendering/ECS dependencies.

import { TILE_TYPES, type FaceKind, type TileType } from "./tiles";

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

function cellKey(x: number, z: number): string {
  return `${x},${z}`;
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
    const footprint = rotatedFootprint(type, instance.rotation);
    for (const [key, sides] of footprint.cells) {
      const [lx, lz] = key.split(",").map(Number);
      const worldKey = cellKey(instance.originCell.x + lx, instance.originCell.z + lz);
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
    const [x, z] = key.split(",").map(Number);
    for (const dir of NEIGHBOR_DIRS) {
      const kind = cell.sides[dir.mine];
      if (kind === null) continue; // interior to this tile instance

      const neighborKey = cellKey(x + dir.dx, z + dir.dz);
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
 * Looks up the sector containing a world XZ position (meters), or
 * `undefined` if it isn't inside any placed tile. Per the design notes this
 * is authoring/tracking data only — nothing gates simulation on it.
 */
export function sectorAt(index: OccupancyIndex, worldX: number, worldZ: number, unit: number): string | undefined {
  const cellX = Math.floor(worldX / unit);
  const cellZ = Math.floor(worldZ / unit);
  return index.get(cellKey(cellX, cellZ))?.sectorId;
}
