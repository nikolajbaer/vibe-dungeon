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

/**
 * Everything a sector's worth of level geometry/lighting needs registered
 * once, at build time, so later toggling is O(objects actually in that
 * sector) rather than a per-object distance check every frame. Populated
 * incrementally as `tileBuilder.ts`/`stairBuilder.ts`/`spawning.ts` build
 * each piece of the level (see `registerObject`/`registerShadowLight`
 * below), then consumed once by `applySectorVisibility` whenever the
 * player's active-sector set changes.
 */
export interface SectorVisibility {
  objectsBySector: Map<string, THREE.Object3D[]>;
  shadowLightsBySector: Map<string, THREE.Light[]>;
}

export function createSectorVisibility(): SectorVisibility {
  return { objectsBySector: new Map(), shadowLightsBySector: new Map() };
}

/**
 * Tags `object` as belonging to `sectorId` for the geometry-visibility pass
 * (`mesh.visible` toggling — see `applySectorVisibility`). `sectorId` is
 * `undefined` for the rare case a caller couldn't resolve one (shouldn't
 * happen for anything actually placed inside the level's tile grid, but
 * "fail open" — an unregistered object is simply never toggled, i.e. it
 * stays permanently visible, rather than risking a real object silently
 * going dark because a lookup came back empty).
 */
export function registerSectorObject(vis: SectorVisibility, sectorId: string | undefined, object: THREE.Object3D): void {
  if (sectorId === undefined) return;
  let list = vis.objectsBySector.get(sectorId);
  if (!list) vis.objectsBySector.set(sectorId, (list = []));
  list.push(object);
}

/** Same idea as `registerSectorObject`, for the shadow-gating pass
 * (`light.castShadow` toggling). Only ever called for a light that's
 * `castShadow = true` by design (see `tileBuilder.ts`'s `addTorch`) — this
 * module doesn't turn shadow-casting *on* for a light that was never meant
 * to cast one, only gates it off/back-on for sectors that aren't currently
 * relevant. */
export function registerSectorShadowLight(vis: SectorVisibility, sectorId: string | undefined, light: THREE.Light): void {
  if (sectorId === undefined) return;
  let list = vis.shadowLightsBySector.get(sectorId);
  if (!list) vis.shadowLightsBySector.set(sectorId, (list = []));
  list.push(light);
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
  for (const [sectorId, objects] of vis.objectsBySector) {
    const visible = active === undefined || active.has(sectorId);
    for (const object of objects) object.visible = visible;
  }
  for (const [sectorId, lights] of vis.shadowLightsBySector) {
    const cast = active === undefined || active.has(sectorId);
    for (const light of lights) light.castShadow = cast;
  }
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
  let totalObjects = 0;
  for (const objects of vis.objectsBySector.values()) {
    totalObjects += objects.length;
    for (const object of objects) if (object.visible) visibleObjects++;
  }
  let shadowCastingLights = 0;
  let totalShadowCapableLights = 0;
  for (const lights of vis.shadowLightsBySector.values()) {
    totalShadowCapableLights += lights.length;
    for (const light of lights) if (light.castShadow) shadowCastingLights++;
  }
  return { visibleObjects, totalObjects, shadowCastingLights, totalShadowCapableLights };
}
