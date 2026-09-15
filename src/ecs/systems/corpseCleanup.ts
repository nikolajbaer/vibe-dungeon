import { query, type World } from "bitecs";
import { Dead, DeathSector, Object3DRef } from "../components";

/** Minimum time (seconds) a corpse stays on-screen no matter what, counted
 * down by this system from the moment `DeathSector` is added (see
 * `DeathSector.lingerRemaining`'s doc comment in components.ts) — a plain
 * sector-mismatch check (see the doc comment below) turned out to fire far
 * too eagerly once NPCs could actually move around during a fight: an
 * aggressive archetype can die mid-chase in a different sector than the
 * player currently stands in, and the player's own death (from the same
 * fight) can teleport them back to the level spawn on respawn, both of
 * which used to make a freshly-killed corpse vanish before the player ever
 * had a chance to see it lying there. */
export const MIN_LINGER_SECONDS = 3;

/**
 * One-way corpse cleanup (issue #59): once a corpse has been visible for at
 * least `MIN_LINGER_SECONDS` *and* the player has left the sector it died
 * in, its mesh is removed from the scene — a one-way cleanup, not a
 * presence toggle. A corpse that's already been cleaned up stays gone even
 * if the player later re-enters the death sector; this module never re-adds
 * a mesh.
 *
 * Run once per frame from game.ts, given the player's current sector
 * (`level.sectorAt(...)`, already computed there each frame for the
 * existing sector-change logging — no need to recompute it here) and the
 * frame's `dt`, to count down `lingerRemaining`.
 *
 * Targets every entity carrying both `Dead` and `DeathSector` (today, only
 * ever the one test NPC, but this doesn't assume that) whose
 * `DeathSector.sectorId` is still set (i.e. not yet cleaned up). `sectorId`
 * is cleared back to `undefined` right after removing the mesh, both
 * marking the corpse as cleaned up (so this doesn't re-run every subsequent
 * frame) and guarding against `removeFromParent` being called again on a
 * mesh already removed.
 */
export function corpseCleanupSystem(world: World, playerSector: string | undefined, dt: number): void {
  for (const eid of query(world, [Dead, DeathSector])) {
    const deathSector = DeathSector.sectorId[eid];
    if (deathSector === undefined) continue; // already cleaned up

    DeathSector.lingerRemaining[eid] = Math.max(0, DeathSector.lingerRemaining[eid] - dt);
    if (DeathSector.lingerRemaining[eid] > 0) continue; // hasn't had its minimum time on-screen yet
    if (deathSector === playerSector) continue; // player hasn't left yet

    Object3DRef[eid]?.removeFromParent();
    DeathSector.sectorId[eid] = undefined;
  }
}
