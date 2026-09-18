import * as THREE from "three";
import type { World } from "bitecs";
import { UNIT } from "./tiles";
import { buildOccupancyIndex, validateOccupancy, sectorAt, buildSectorGraph, type OccupancyIndex, type SectorGraph } from "./occupancy";
import { buildGeometryFromOccupancy } from "./tileBuilder";
import { buildStaircases } from "./stairBuilder";
import { spawnProps, spawnItems, spawnNpcs, spawnReadables } from "./spawning";
import { ALL_TILE_INSTANCES, ALL_PROPS, ALL_ITEM_SPAWNS, ALL_NPC_SPAWNS, ALL_STAIR_CONNECTORS, ALL_LOCKED_DOORS, ALL_READABLES, LEVEL_SPAWN } from "./rooms";
import type { LevelSpawn } from "./placementTypes";
import type { Physics } from "../physics/world";
import { createSectorVisibility, activeSectorSet, applySectorVisibility, visibilityDebugCounts, type SectorVisibility } from "./visibility";

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
  /** Perf investigation (see `visibility.ts`): recomputes and applies which
   * sectors' shadow-casting lights (and, once `visibility.ts`'s geometry
   * registration lands, static meshes) should stay active, based on
   * `currentSectorId`. Cheap to call every frame — internally a no-op unless
   * the active set actually changed since the last call, so `game.ts` never
   * needs to gate the call itself on "did the sector change." */
  updateVisibility(currentSectorId: string | undefined): void;
  /** Debug/test hook (see `game.ts`'s `__vibeDungeonDebug`) — how many
   * registered shadow-capable lights currently have `castShadow` on, vs. how
   * many exist in total, plus the same for registered geometry's `visible`
   * flag. Lets Playwright assert the gating measurably drops these counts
   * when the player walks away, not just that the code ran. */
  getVisibilityDebugCounts: () => ReturnType<typeof visibilityDebugCounts>;
}

export function buildLevel(world: World, physics: Physics, scene: THREE.Scene): Level {
  const occupancy: OccupancyIndex = buildOccupancyIndex(ALL_TILE_INSTANCES);
  validateOccupancy(occupancy);
  const sectorGraph: SectorGraph = buildSectorGraph(occupancy);
  const vis: SectorVisibility = createSectorVisibility();
  buildGeometryFromOccupancy(world, physics, scene, occupancy, ALL_LOCKED_DOORS, vis);
  buildStaircases(physics, scene, ALL_STAIR_CONNECTORS);
  spawnProps(world, physics, scene, ALL_PROPS);
  spawnItems(world, physics, scene, ALL_ITEM_SPAWNS);
  spawnNpcs(world, physics, scene, ALL_NPC_SPAWNS);
  spawnReadables(world, scene, ALL_READABLES);

  // `undefined` (no active-set computed yet) until the very first
  // `updateVisibility` call — deliberately starts every registered light
  // fully active (see `applySectorVisibility`'s own "undefined means leave
  // everything active" contract) rather than gated off, so there's never a
  // one-frame flash of "everything's dark" before the player's starting
  // sector is known.
  let lastActive: Set<string> | undefined;

  return {
    spawn: LEVEL_SPAWN,
    sectorAt: (worldX, worldY, worldZ) => sectorAt(occupancy, worldX, worldY, worldZ, UNIT),
    updateVisibility: (currentSectorId) => {
      const active = activeSectorSet(currentSectorId, sectorGraph);
      // Set-equality check, not reference — `activeSectorSet` builds a fresh
      // `Set` every call, so `===` would always be false and this guard
      // would never actually skip anything.
      if (setsEqual(active, lastActive)) return;
      lastActive = active;
      applySectorVisibility(vis, active);
    },
    getVisibilityDebugCounts: () => visibilityDebugCounts(vis),
  };
}

function setsEqual(a: Set<string> | undefined, b: Set<string> | undefined): boolean {
  if (a === b) return true; // both undefined
  if (a === undefined || b === undefined) return false;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
