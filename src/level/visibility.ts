import * as THREE from "three";
import type { SectorGraph } from "./occupancy";

// Sector-scoped render-cost gating (perf investigation: the level had grown
// to enough simultaneous rooms/torches that every shadow-casting light and
// every piece of static geometry in the *entire* level was being asked of
// the GPU every frame, regardless of where the player actually was — see the
// PR this shipped in for the profiling that established that). This module
// is deliberately just bookkeeping (per-sector registries, built once at
// level-load time) plus one small setter (`applySectorVisibility`) — it
// never touches Rapier, never removes anything from the scene graph, and
// never changes what a shadow-casting light or a piece of geometry actually
// looks like. All it does is flip
// `THREE.Light.castShadow` / `THREE.Object3D.visible` off for whatever
// belongs to a sector that isn't the player's current one or one open
// connection away from it, and back on the instant that stops being true.
//
// **Why "current + one open connection away," not just "current."** A room
// glimpsed through an open doorway from an adjacent sector has to keep
// looking exactly like it does today — its torches still casting shadows,
// its walls still rendered — or a player standing in the doorway (or just
// approaching it) would see it visibly change. Gating strictly to the
// player's *own* cell would pop that neighboring room's lighting/geometry
// off the instant the player's cell right at the threshold flips sectors,
// which is exactly the kind of visible regression this work isn't allowed
// to introduce. One hop through `SectorGraph` (`occupancy.ts`) says
// "reachable through one open boundary," which is a connectivity radius, not
// a distance one — a large room's far corner is just as "adjacent" as its
// near one, so there's no popping as the player walks *across* a room
// either, only when they cross into a sector two-or-more connections away
// from anything they could currently see.
//
// **Known limitation**, not currently observed anywhere in the map: a
// sightline that reaches straight through two consecutive open doorways
// (sector A -> B -> C, all three actually visible at once from deep in A)
// would have C's geometry/shadows gated off despite being genuinely visible.
// Nothing in the current level lines up two doorways like that (every branch
// point is a hub/junction, not a single long sightline), so this hasn't
// needed a raise from a 1-hop to a 2-hop radius — worth knowing if a future
// room design ever adds a long straight-through sightline spanning more than
// one doorway.

// A registered object's/light's sector lives on its own `userData.sectorId`
// (a plain string tag), not as the key of some `Map<sectorId, ...>` bucket —
// deliberately, so a *moved* object (the one case where "which sector is
// this in" changes after build time: a player-dropped item, see
// `dropCarriedItem` in spawning.ts) can just have its tag overwritten in
// place via `retagSectorObject` below, with nothing to move between buckets
// and no stale bucket membership left behind. `applySectorVisibility` reads
// the tag fresh every time it runs, so retagging takes effect on the very
// next sector-change tick like anything else.
const SECTOR_TAG = "sectorId";

/**
 * Everything level geometry/lighting needs registered once, at build time,
 * so later toggling is O(objects actually registered) rather than a
 * per-object distance check every frame. Populated incrementally as
 * `tileBuilder.ts`/`stairBuilder.ts`/`spawning.ts` build each piece of the
 * level (see `registerSectorObject`/`registerSectorShadowLight` below), then
 * consumed once by `applySectorVisibility` whenever the player's
 * active-sector set changes.
 */
export interface SectorVisibility {
  objects: THREE.Object3D[];
  shadowLights: THREE.PointLight[];
}

export function createSectorVisibility(): SectorVisibility {
  return { objects: [], shadowLights: [] };
}

/**
 * Tags `object` as belonging to `sectorId` for the geometry-visibility pass
 * (`mesh.visible` toggling — see `applySectorVisibility`) and registers it.
 * `sectorId` is `undefined` for the rare case a caller couldn't resolve one
 * (shouldn't happen for anything actually placed inside the level's tile
 * grid, but "fail open" — an unregistered object is simply never toggled,
 * i.e. it stays permanently visible, rather than risking a real object
 * silently going dark because a lookup came back empty).
 */
export function registerSectorObject(vis: SectorVisibility, sectorId: string | undefined, object: THREE.Object3D): void {
  if (sectorId === undefined) return;
  object.userData[SECTOR_TAG] = sectorId;
  vis.objects.push(object);
}

/** Same idea as `registerSectorObject`, for the shadow-gating pass
 * (`light.castShadow` toggling). Only ever called for a light that's
 * `castShadow = true` by design (see `tileBuilder.ts`'s `addTorch`) — this
 * module doesn't turn shadow-casting *on* for a light that was never meant
 * to cast one, only gates it off/back-on for sectors that aren't currently
 * relevant. */
export function registerSectorShadowLight(vis: SectorVisibility, sectorId: string | undefined, light: THREE.PointLight): void {
  if (sectorId === undefined) return;
  light.userData[SECTOR_TAG] = sectorId;
  vis.shadowLights.push(light);
}

/**
 * Re-tags an already-registered object to a different sector — the one case
 * an object's sector membership can legitimately change after level-build
 * time: `dropCarriedItem` (spawning.ts) reuses a world item's existing mesh
 * (rather than building a new one) when the player drops something they
 * picked up, and that mesh may have been registered under whatever sector it
 * was *originally spawned* in, which is meaningless once it's been carried
 * off and dropped somewhere else entirely (a different room, possibly a
 * different sector). Without this, the mesh would keep obeying its stale
 * original sector's on/off state forever — visibly wrong the next time that
 * *original* sector's active state changes, regardless of where the item
 * actually now sits. `sectorId: undefined` (couldn't resolve one for the
 * drop position — e.g. dropped through a physics glitch outside any tile)
 * clears the tag entirely, which `applySectorVisibility` treats as "always
 * visible" (fail open), the same spirit as never registering it at all. */
export function retagSectorObject(object: THREE.Object3D, sectorId: string | undefined): void {
  if (sectorId === undefined) delete object.userData[SECTOR_TAG];
  else object.userData[SECTOR_TAG] = sectorId;
}

/** The player's current sector plus every sector one open connection away
 * from it, per this module's header comment. `undefined` (no resolvable
 * current sector — e.g. a momentary gap while falling) means "don't know,
 * so don't restrict anything" — returns `undefined` back out, which
 * `applySectorVisibility`'s caller (`level.ts`'s `updateVisibility`) treats
 * as "leave every sector active" rather than guessing. */
export function activeSectorSet(currentSectorId: string | undefined, graph: SectorGraph): Set<string> | undefined {
  if (currentSectorId === undefined) return undefined;
  const active = new Set<string>([currentSectorId]);
  for (const neighbor of graph.get(currentSectorId) ?? []) active.add(neighbor);
  return active;
}

/**
 * Applies `active` (from `activeSectorSet`, or `undefined` to mean "every
 * sector active") to every registered object/light. `undefined` sets
 * everything visible/shadow-casting regardless of sector — the fail-safe for
 * "couldn't resolve a current sector," and also exactly what a level with no
 * player-position data yet (before the very first frame) should look like.
 *
 * Cheap to call unconditionally every frame (it's a no-op re-application,
 * not a scan of the whole scene graph) — `level.ts`'s `updateVisibility`
 * still only calls this when the active set actually changed, purely
 * because there's no reason to redo even this small amount of work when
 * nothing did.
 */
export function applySectorVisibility(vis: SectorVisibility, active: Set<string> | undefined): void {
  for (const object of vis.objects) {
    const sectorId = object.userData[SECTOR_TAG] as string | undefined;
    // A missing tag (see `retagSectorObject`) means "not sector-gated
    // anymore" -- fail open, same as never having registered it.
    object.visible = active === undefined || sectorId === undefined || active.has(sectorId);
  }
  for (const light of vis.shadowLights) {
    const sectorId = light.userData[SECTOR_TAG] as string | undefined;
    const cast = active === undefined || sectorId === undefined || active.has(sectorId);
    // A light re-entering the active set needs at least one real shadow-map
    // render before its shadow is trustworthy again: `light.shadow.autoUpdate`
    // is false (see `tileBuilder.ts`'s `addTorch`), so without this forced
    // `needsUpdate`, a light that just turned back on would keep reusing
    // whatever shadow map (possibly none at all, the very first time) it had
    // from before — `refreshDynamicShadows` below handles staying fresh
    // *while* a light stays active, but can't fix the very frame it turns on.
    if (cast && !light.castShadow) light.shadow.needsUpdate = true;
    light.castShadow = cast;
  }
}

// Scratch vector reused across `refreshDynamicShadows` calls (one per
// rendered frame) so it never allocates — `Object3D.getWorldPosition`
// requires somewhere to write into, and there's no reason to hand it a
// fresh `Vector3` every light, every frame.
const scratchLightPos = new THREE.Vector3();

/**
 * The other half of the "cheaper than baking" approximation described in
 * `tileBuilder.ts`'s `addTorch` (see that comment for the full reasoning):
 * with `light.shadow.autoUpdate = false`, a currently-active light's shadow
 * map otherwise only gets refreshed by `applySectorVisibility`'s
 * off-to-on transition — correct for a light nothing ever moves near, but
 * wrong the moment something that *does* cast a shadow (the player, an NPC)
 * walks through it: without this, that mover's shadow would freeze at
 * wherever it happened to be standing when the light last got a real
 * render, a visibly stale "shadow ghost" left behind as it walks away.
 *
 * Called once per rendered frame (game.ts, right before `renderer.render`)
 * with the current world position of every entity whose movement could
 * plausibly need a fresh shadow (the player, every NPC) — deliberately not
 * dynamic props/items too: the one way a static prop moves is being shoved
 * by the player, who's already in `moverPositions` and, being right next to
 * it to shove it in the first place, already within range of whatever light
 * would need refreshing.
 *
 * `margin` pads each light's own falloff range (`light.distance`) to cover a
 * mover's own size (its shadow can start forming slightly before its center
 * point crosses the light's nominal range) — a fixed constant rather than
 * per-mover geometry, since this only has to be "generous enough," not
 * exact: a few extra frames of refresh past the true edge costs nothing a
 * culled-off light wouldn't already have cost before this optimization
 * existed at all.
 */
// Returns how many lights this call actually flagged with `needsUpdate = true`
// -- purely a debug/measurement number (see `game.ts`'s `getShadowRefreshCount`
// hook), not used for any decision inside this module itself.
export function refreshDynamicShadows(vis: SectorVisibility, moverPositions: readonly { x: number; y: number; z: number }[], margin: number): number {
  let refreshed = 0;
  for (const light of vis.shadowLights) {
    if (!light.castShadow) continue; // gated off -- no shadow map worth keeping fresh
    light.getWorldPosition(scratchLightPos);
    const range = (light.distance || 0) + margin;
    const rangeSq = range * range;
    for (const pos of moverPositions) {
      const dx = pos.x - scratchLightPos.x;
      const dy = pos.y - scratchLightPos.y;
      const dz = pos.z - scratchLightPos.z;
      if (dx * dx + dy * dy + dz * dz <= rangeSq) {
        light.shadow.needsUpdate = true;
        refreshed++;
        break;
      }
    }
  }
  return refreshed;
}

/** Debug/test counters — how many of each registered thing are currently
 * "on," vs. how many exist in total. Exposed via `window.__vibeDungeonDebug`
 * (see `game.ts`) so Playwright can assert the culling is actually doing
 * something (a real, measured drop when the player walks away) rather than
 * only trusting that the code path ran. */
export function visibilityDebugCounts(vis: SectorVisibility): {
  visibleObjects: number;
  totalObjects: number;
  shadowCastingLights: number;
  totalShadowCapableLights: number;
} {
  let visibleObjects = 0;
  for (const object of vis.objects) if (object.visible) visibleObjects++;
  let shadowCastingLights = 0;
  for (const light of vis.shadowLights) if (light.castShadow) shadowCastingLights++;
  return {
    visibleObjects,
    totalObjects: vis.objects.length,
    shadowCastingLights,
    totalShadowCapableLights: vis.shadowLights.length,
  };
}
