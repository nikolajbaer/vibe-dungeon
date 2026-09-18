import * as THREE from "three";
import type { World } from "bitecs";
import { UNIT } from "./tiles";
import { buildOccupancyIndex, validateOccupancy, sectorAt, type OccupancyIndex } from "./occupancy";
import { buildGeometryFromOccupancy } from "./tileBuilder";
import { buildStaircases } from "./stairBuilder";
import { spawnProps, spawnItems, spawnNpcs, spawnReadables } from "./spawning";
import { ALL_TILE_INSTANCES, ALL_PROPS, ALL_ITEM_SPAWNS, ALL_NPC_SPAWNS, ALL_STAIR_CONNECTORS, ALL_LOCKED_DOORS, ALL_READABLES, LEVEL_SPAWN } from "./rooms";
import type { LevelSpawn } from "./placementTypes";
import type { Physics } from "../physics/world";

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
   * nothing gates simulation on this; it's for debugging/future tooling.
   * Takes `worldY` (issue #86) so it can tell which *floor* a position is on
   * when two floors share XZ space — see `occupancy.ts`'s `sectorAt`. */
  sectorAt(worldX: number, worldY: number, worldZ: number): string | undefined;
}

export function buildLevel(world: World, physics: Physics, scene: THREE.Scene): Level {
  const occupancy: OccupancyIndex = buildOccupancyIndex(ALL_TILE_INSTANCES);
  validateOccupancy(occupancy);
  buildGeometryFromOccupancy(world, physics, scene, occupancy, ALL_LOCKED_DOORS);
  buildStaircases(physics, scene, ALL_STAIR_CONNECTORS);
  spawnProps(world, physics, scene, ALL_PROPS);
  spawnItems(world, physics, scene, ALL_ITEM_SPAWNS);
  spawnNpcs(world, physics, scene, ALL_NPC_SPAWNS);
  spawnReadables(world, scene, ALL_READABLES);

  return {
    spawn: LEVEL_SPAWN,
    sectorAt: (worldX, worldY, worldZ) => sectorAt(occupancy, worldX, worldY, worldZ, UNIT),
  };
}
