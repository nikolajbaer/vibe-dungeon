import { query, type World } from "bitecs";
import { Dead, DeathSector, Object3DRef } from "../components";

/**
 * One-way corpse cleanup (issue #59): once the player has left the sector an
 * entity died in, its corpse mesh is removed from the scene — a one-way
 * cleanup, not a presence toggle. A corpse that's already been cleaned up
 * stays gone even if the player later re-enters the death sector; this
 * module never re-adds a mesh.
 *
 * Run once per frame from game.ts, given the player's current sector
 * (`level.sectorAt(...)`, already computed there each frame for the
 * existing sector-change logging — no need to recompute it here).
 *
 * Targets every entity carrying both `Dead` and `DeathSector` (today, only
 * ever the one test NPC, but this doesn't assume that) whose
 * `DeathSector.sectorId` is still set (i.e. not yet cleaned up) and differs
 * from `playerSector`. `sectorId` is cleared back to `undefined` right after
 * removing the mesh, both marking the corpse as cleaned up (so this doesn't
 * re-run every subsequent frame) and guarding against `removeFromParent`
 * being called again on a mesh already removed.
 */
export function corpseCleanupSystem(world: World, playerSector: string | undefined): void {
  for (const eid of query(world, [Dead, DeathSector])) {
    const deathSector = DeathSector.sectorId[eid];
    if (deathSector === undefined) continue; // already cleaned up
    if (deathSector === playerSector) continue; // player hasn't left yet

    Object3DRef[eid]?.removeFromParent();
    DeathSector.sectorId[eid] = undefined;
  }
}
