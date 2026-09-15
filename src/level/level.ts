import * as THREE from "three";
import type { World } from "bitecs";
import { UNIT } from "./tiles";
import { buildOccupancyIndex, validateOccupancy, sectorAt, type OccupancyIndex } from "./occupancy";
import { buildGeometryFromOccupancy } from "./tileBuilder";
import { spawnProps, spawnItems } from "./spawning";
import { ALL_TILE_INSTANCES, ALL_PROPS, ALL_ITEM_SPAWNS, LEVEL_SPAWN } from "./rooms";
import type { LevelSpawn } from "./placementTypes";

// Builds the level from tile instances (issue #21): places every room's
// tile instances (`ALL_TILE_INSTANCES`, auto-aggregated from
// `src/level/rooms/*.ts` by `./rooms.ts`) into an occupancy index, validates
// it (the load-time "level linter" — throws with a clear message if an
// author gets adjacent faces wrong), then decomposes it into the same
// wall/floor/ceiling/door boxes the old hand-placed level used to build
// directly. See `src/level/rooms/` for the authored layout and README's
// "Tile-based level system" / "Asset-authoring system" design notes for the
// format itself.

export interface Level {
  spawn: LevelSpawn;
  /** The player's current sector, looked up from the occupancy index by
   * world position. Authoring/tracking data only (see README "Sectors") —
   * nothing gates simulation on this; it's for debugging/future tooling. */
  sectorAt(worldX: number, worldZ: number): string | undefined;
}

export function buildLevel(world: World, scene: THREE.Scene): Level {
  const occupancy: OccupancyIndex = buildOccupancyIndex(ALL_TILE_INSTANCES);
  validateOccupancy(occupancy);
  buildGeometryFromOccupancy(world, scene, occupancy);
  spawnProps(world, scene, ALL_PROPS);
  spawnItems(world, scene, ALL_ITEM_SPAWNS);

  return {
    spawn: LEVEL_SPAWN,
    sectorAt: (worldX, worldZ) => sectorAt(occupancy, worldX, worldZ, UNIT),
  };
}
