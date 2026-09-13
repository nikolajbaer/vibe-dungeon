import * as THREE from "three";
import type { World } from "bitecs";
import { UNIT } from "./tiles";
import { buildOccupancyIndex, validateOccupancy, sectorAt, type OccupancyIndex } from "./occupancy";
import { buildGeometryFromOccupancy } from "./tileBuilder";
import { LEVEL_TILES, LEVEL_SPAWN } from "./levelData";
import { addDecorations } from "./decorations";

// Builds the level from tile instances (issue #21): places LEVEL_TILES
// into an occupancy index, validates it (the load-time "level linter" —
// throws with a clear message if an author gets adjacent faces wrong),
// then decomposes it into the same wall/floor/ceiling/door boxes the old
// hand-placed level used to build directly. See levelData.ts for the
// authored layout and README's "Tile-based level system" design notes for
// the format itself.

export interface LevelSpawn {
  x: number;
  z: number;
  yaw: number;
}

export interface Level {
  spawn: LevelSpawn;
  /** The player's current sector, looked up from the occupancy index by
   * world position. Authoring/tracking data only (see README "Sectors") —
   * nothing gates simulation on this; it's for debugging/future tooling. */
  sectorAt(worldX: number, worldZ: number): string | undefined;
}

export function buildLevel(world: World, scene: THREE.Scene): Level {
  const occupancy: OccupancyIndex = buildOccupancyIndex(LEVEL_TILES);
  validateOccupancy(occupancy);
  buildGeometryFromOccupancy(world, scene, occupancy);
  addDecorations(world, scene);

  return {
    spawn: LEVEL_SPAWN,
    sectorAt: (worldX, worldZ) => sectorAt(occupancy, worldX, worldZ, UNIT),
  };
}
