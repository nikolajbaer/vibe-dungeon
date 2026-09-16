import * as THREE from "three";
import { UNIT, floorBaseline } from "./tiles";
import { wallMaterial } from "./materials";
import { WALL_THICKNESS } from "./tileBuilder";
import { addStaticBox, addStaticRampBox, MAX_SLOPE_CLIMB_DEGREES, type Physics } from "../physics/world";
import type { StairConnector } from "./placementTypes";

// Builds the actual climbable geometry for a vertical connection between two
// floors (issue #86) — a real Rapier collider, not a bespoke traversal
// system. This is deliberately a separate module from `tileBuilder.ts`: a
// `StairConnector` isn't a tile at all (it has no face map, no occupancy
// cell, no wall/floor/ceiling of its own — see `TileType.skipFloorSlab`/
// `skipCeilingSlab` for how its two flanking tile instances, `stair_lower.ts`/
// `stair_upper.ts`, get out of the way so this geometry has somewhere to
// go), so it doesn't belong in the generic per-cell wall/floor/ceiling walk.
//
// **Collision is one smooth ramp, not stepped risers — found the hard way.**
// The original design here was real stepped risers, leaning on the
// character controller's autostep (`AUTOSTEP_MAX_HEIGHT`, physics/world.ts)
// to climb each one — exactly what that constant's own doc comment
// advertises ("exactly the knob a future stair tile leans on"). It rendered
// correctly and the occupancy/face-map data was verified correct, but an
// actual Playwright walk-up kept dead-stopping at the very first riser, not
// even attempting to climb. Isolated the cause with a throwaway single
// static test box unrelated to any of this level's tiles: autostep did not
// engage at all in this build, for *any* step height (tried well under
// `AUTOSTEP_MAX_HEIGHT`, non-overlapping vs. nested box shapes, nothing
// changed it) — a pre-existing characteristic of this Rapier version/
// environment, not a bug in this staircase's geometry. Rather than build the
// first real stairs in the game on a foundation that's never actually been
// proven to work, this switched to the controller's *other* climbing
// feature — `setMaxSlopeClimbAngle` (physics/world.ts) — which a separate
// isolated ramp test confirmed does work, cleanly, at angles well past what
// this staircase needs. If a future change fixes autostep and someone wants
// real per-step collision again, this is the file to revisit; until then,
// `AUTOSTEP_MAX_HEIGHT`'s doc comment about stairs is aspirational, not
// current behavior.
//
// **The visual is still real stair steps.** A player shouldn't be able to
// tell the collision underneath is a smooth ramp — `buildStairVisual` builds
// a set of solid, non-overlapping stepped boxes (mesh only, no collider)
// whose outer top corners lie exactly on the ramp's slope line, so the
// silhouette reads as genuine stairs while the ramp collider (invisible,
// beneath/inside that silhouette) is what the character actually walks on.
// Mismatched "the collision is simpler than the visual" geometry is a
// standard technique for exactly this situation (stepped stairs a character
// controller climbs via slope rather than per-step collision) — the minor
// consequence is that a foot can be a few centimeters above or below its
// nearest visible tread mid-climb, not visible at normal play distance/pace.

/** Grid cells of horizontal run a `StairConnector`'s shaft spans, along
 * `axis` — sets the ramp's angle for a given `FLOOR_RISE`. 3 cells (9m) over
 * `FLOOR_RISE` (6m) works out to ~33.7 degrees, comfortably under
 * `MAX_SLOPE_CLIMB_DEGREES` (50) with real margin — the exact angle an
 * isolated Playwright ramp test confirmed climbs smoothly; a shallower
 * ramp (say a 2-cell/45-degree run, closer to that limit) hasn't been
 * verified to actually work and risks the same kind of "looks fine on paper,
 * silently doesn't climb" failure that sank the stepped-riser design above. */
const STAIR_RUN_CELLS = 3;
const STAIR_HALF_WIDTH = UNIT / 2 - 0.2; // leaves a small gap to the shaft's flanking walls

/** Purely visual step count/height — no longer load-bearing for climbing
 * (see this file's header comment), so these are picked for how the stairs
 * *look* rather than for satisfying autostep. ~0.375m risers over ~0.375m
 * treads read as a real, fairly steep stone staircase. */
const VISUAL_RISER_COUNT = 16;

interface RampGeometry {
  /** World-space entry point (bottom of the climb) and exit point (top). */
  entry: THREE.Vector3;
  exit: THREE.Vector3;
  /** Perpendicular horizontal half-width of the shaft. */
  halfWidth: number;
  /** Which horizontal axis the ramp climbs along ("x" or "z"), and the
   * perpendicular horizontal axis' fixed world coordinate (the shaft's own
   * center on that axis). */
  climbAxis: "x" | "z";
  perpCoord: number;
}

function rampGeometryOf(connector: StairConnector): RampGeometry {
  const rise = floorBaseline(connector.floorAbove) - floorBaseline(connector.floorBelow);
  const totalRun = STAIR_RUN_CELLS * UNIT;
  const angleDeg = (Math.atan2(rise, totalRun) * 180) / Math.PI;
  if (angleDeg >= MAX_SLOPE_CLIMB_DEGREES) {
    // Same "fail loudly at build time" philosophy as validateOccupancy —
    // a level that ships a staircase steeper than the character controller
    // can actually climb is a bug, not a valid level.
    throw new Error(
      `stairBuilder: connector at (${connector.x},${connector.z}) climbs at ${angleDeg.toFixed(1)} degrees, ` +
        `at or past the character controller's ${MAX_SLOPE_CLIMB_DEGREES}-degree max — widen STAIR_RUN_CELLS.`,
    );
  }

  const originAlong = connector.axis === "x" ? connector.x : connector.z;
  const perpCell = connector.axis === "x" ? connector.z : connector.x;
  const perpCoord = (perpCell + 0.5) * UNIT;
  const entryAlong = connector.direction === 1 ? originAlong * UNIT : (originAlong + STAIR_RUN_CELLS) * UNIT;
  const exitAlong = connector.direction === 1 ? (originAlong + STAIR_RUN_CELLS) * UNIT : originAlong * UNIT;
  const entryY = floorBaseline(connector.floorBelow);
  const exitY = floorBaseline(connector.floorAbove);

  const entry = connector.axis === "x" ? new THREE.Vector3(entryAlong, entryY, perpCoord) : new THREE.Vector3(perpCoord, entryY, entryAlong);
  const exit = connector.axis === "x" ? new THREE.Vector3(exitAlong, exitY, perpCoord) : new THREE.Vector3(perpCoord, exitY, exitAlong);

  return { entry, exit, halfWidth: STAIR_HALF_WIDTH, climbAxis: connector.axis, perpCoord };
}

/**
 * The real Rapier collider: one static box running the length of the shaft,
 * tilted so its top face passes exactly through `entry` and `exit`.
 *
 * The box's local half-length along its climb axis is half the ramp's
 * *slope length* (`entry.distanceTo(exit) / 2`), not half the horizontal
 * run — see `addStaticRampBox`'s doc comment (physics/world.ts) for why
 * that distinction matters and what silently goes wrong if it's skipped.
 * The rotation is built with `Quaternion.setFromUnitVectors`, pointing the
 * box's local climb axis (`+X` or `+Z`, matching `climbAxis`) at the real
 * world direction from `entry` to `exit` — this is what sidesteps having to
 * work out a signed pitch angle for an arbitrary climb direction by hand.
 */
function buildRampCollider(physics: Physics, geo: RampGeometry): void {
  const slopeLength = geo.entry.distanceTo(geo.exit);
  const halfSlope = slopeLength / 2;
  const center = geo.entry.clone().add(geo.exit).multiplyScalar(0.5);
  const direction = geo.exit.clone().sub(geo.entry).normalize();

  const localAxis = geo.climbAxis === "x" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion().setFromUnitVectors(localAxis, direction);

  const hx = geo.climbAxis === "x" ? halfSlope : geo.halfWidth;
  const hz = geo.climbAxis === "x" ? geo.halfWidth : halfSlope;
  // A thin ramp (small hy) so the collider hugs the visual steps' envelope
  // closely rather than burying a thick slab through them.
  const hy = 0.1;

  addStaticRampBox(physics, center.x, center.y, center.z, hx, hy, hz, { x: quat.x, y: quat.y, z: quat.z, w: quat.w });
}

/**
 * Purely cosmetic stepped stair mesh (no collider — see this file's header
 * comment) — `VISUAL_RISER_COUNT` non-overlapping boxes, each spanning its
 * own tread's horizontal slice and rising from the shaft's floor to that
 * step's own height, the classic "stacked blocks" technique for a solid,
 * gap-free stair silhouette. Each step's outer top corner lands exactly on
 * the ramp collider's slope line by construction (both are parameterized
 * off the same `entry`/`exit` points), so the visual reads as sitting right
 * on the ramp rather than floating above or clipping through it.
 */
function buildStairVisual(scene: THREE.Scene, geo: RampGeometry): void {
  const material = wallMaterial();
  const rise = geo.exit.y - geo.entry.y;
  const totalRunAlong = geo.climbAxis === "x" ? geo.exit.x - geo.entry.x : geo.exit.z - geo.entry.z;
  const riserHeight = rise / VISUAL_RISER_COUNT;
  const treadRun = totalRunAlong / VISUAL_RISER_COUNT;
  const entryAlong = geo.climbAxis === "x" ? geo.entry.x : geo.entry.z;
  const baseY = geo.entry.y;

  for (let i = 0; i < VISUAL_RISER_COUNT; i++) {
    const stepLeadAlong = entryAlong + i * treadRun;
    const stepFarAlong = entryAlong + (i + 1) * treadRun;
    const loAlong = Math.min(stepLeadAlong, stepFarAlong);
    const hiAlong = Math.max(stepLeadAlong, stepFarAlong);
    const centerAlong = (loAlong + hiAlong) / 2;
    const halfAlong = (hiAlong - loAlong) / 2;
    const stepHeight = (i + 1) * riserHeight;
    const centerY = baseY + stepHeight / 2;

    const cx = geo.climbAxis === "x" ? centerAlong : geo.perpCoord;
    const cz = geo.climbAxis === "x" ? geo.perpCoord : centerAlong;
    const hx = geo.climbAxis === "x" ? halfAlong : geo.halfWidth;
    const hz = geo.climbAxis === "x" ? geo.halfWidth : halfAlong;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, stepHeight, hz * 2), material);
    mesh.position.set(cx, centerY, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

/**
 * Walls the shaft's two long sides for the *entire* floor-to-floor rise —
 * not just each landing's own `h`-sized wall.
 *
 * `stair_lower`/`stair_upper` each get their own north/south walls from the
 * generic tile-builder pass (`buildGeometryFromOccupancy`), but only
 * `STAIR_LANDING_HEIGHT_CELLS` tall above their own floor baseline. For a
 * `FLOOR_RISE` of two cells and a landing height of one, that leaves the
 * *middle* cell of the rise with no wall on either long side at all — real
 * space directly beside the ramp a player can step into, with nothing else
 * in the level's empty surrounding world to catch a fall there (confirmed
 * by actually doing it: a real bug found after this staircase first
 * shipped, not a hypothetical).
 *
 * Deliberately not fixed by giving the landings a taller `h` instead: a
 * uniform taller wall would apply to *every* side of that tile, including
 * the shaft's own end walls — `stair_lower`'s west wall, in particular, is
 * intentionally only `STAIR_LANDING_HEIGHT_CELLS` tall so the climb can
 * pass over its top on the way to `stair_upper`'s opening one floor up; a
 * taller west wall would seal that exit shut at exactly the height the
 * climb needs to pass through it. These guard walls only ever flank the
 * run's two long sides, never its ends, so they can safely span the whole
 * rise without touching that opening.
 *
 * Deliberately spans the *whole* `floorBelow`-to-`floorAbove` range,
 * overlapping the shorter walls each landing already builds, rather than
 * starting exactly where those leave off — computing the precise gap here
 * would mean hardcoding an assumption about where those per-landing walls
 * actually end, in a file that has no direct reference to either tile type.
 * The small overlap costs nothing (two coincident static colliders behave
 * exactly like one) and keeps this correct even if a landing's own height
 * ever changes.
 */
function buildShaftGuardWalls(physics: Physics, scene: THREE.Scene, geo: RampGeometry): void {
  // `geo.entry.y`/`geo.exit.y` are already `floorBaseline(floorBelow)`/
  // `floorBaseline(floorAbove)` (see `rampGeometryOf`) — reading them back
  // out here instead of recomputing from the connector keeps this correct
  // for any pair of floors, not just 0-and-1.
  const loY = geo.entry.y;
  const hiY = geo.exit.y;
  const cy = (loY + hiY) / 2;
  const halfHeight = (hiY - loY) / 2;

  const alongEntry = geo.climbAxis === "x" ? geo.entry.x : geo.entry.z;
  const alongExit = geo.climbAxis === "x" ? geo.exit.x : geo.exit.z;
  const centerAlong = (alongEntry + alongExit) / 2;
  const halfAlong = Math.abs(alongExit - alongEntry) / 2;

  for (const sign of [1, -1] as const) {
    // Centered exactly on the shaft's cell boundary (`UNIT / 2` out from its
    // center), matching how every generic tile wall is placed — flush with
    // the landings' own walls above and below, no seam or visible offset.
    const perp = geo.perpCoord + sign * (UNIT / 2);
    const cx = geo.climbAxis === "x" ? centerAlong : perp;
    const cz = geo.climbAxis === "x" ? perp : centerAlong;
    const hx = geo.climbAxis === "x" ? halfAlong : WALL_THICKNESS;
    const hz = geo.climbAxis === "x" ? WALL_THICKNESS : halfAlong;

    addStaticBox(physics, cx, cy, cz, hx, halfHeight, hz);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, halfHeight * 2, hz * 2), wallMaterial());
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

/** Builds one staircase's real ramp collider, its cosmetic stepped visual,
 * and the guard walls that keep a climbing player from stepping off its
 * sides into empty space, between the two floors a `StairConnector`
 * names. */
export function buildStaircase(physics: Physics, scene: THREE.Scene, connector: StairConnector): void {
  const geo = rampGeometryOf(connector);
  buildRampCollider(physics, geo);
  buildStairVisual(scene, geo);
  buildShaftGuardWalls(physics, scene, geo);
}

/** Builds every staircase in the level (issue #86) — called once from
 * `level.ts`'s `buildLevel`, after the generic tile geometry, since a
 * staircase's shaft only has somewhere to go once its two flanking tile
 * instances have already skipped their own floor/ceiling slabs there. */
export function buildStaircases(physics: Physics, scene: THREE.Scene, connectors: readonly StairConnector[]): void {
  for (const connector of connectors) buildStaircase(physics, scene, connector);
}
