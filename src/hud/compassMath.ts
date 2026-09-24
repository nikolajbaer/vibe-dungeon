// Shared compass math (issue: orientation indicator) — used by both the
// in-game HUD compass (`Compass.tsx`, reading the player's `Rotation.yaw`
// via `hudSync.ts`) and the level viewer's own reference compass
// (`src/viewer/levelViewer.ts`, reading the free-orbit camera's look
// direction instead). Framework-free (no Preact/three.js imports) so both
// call sites — one Preact-rendered, one plain-DOM-manipulated — share the
// exact same angle math rather than risking two independently-derived
// formulas drifting apart.
//
// World convention (established by the tile system — see `tiles.ts`'s
// "local +z = north, +x = east" face-labeling comment, and confirmed by
// room-a.ts's own "player spawns facing south (-z)" comment): **+z = north,
// -z = south, +x = east, -x = west.**

/** A compass bearing in degrees, clockwise from north: 0 = N, 90 = E,
 * 180 = S, 270 = W. */
export type BearingDegrees = number;

/** The four cardinal labels' fixed bearings, in clockwise-from-north order —
 * the single source both the HUD widget and the viewer widget iterate over,
 * so adding a label (e.g. intercardinals) only ever needs to happen once. */
export const COMPASS_CARDINALS: ReadonlyArray<{ label: string; bearing: BearingDegrees }> = [
  { label: "N", bearing: 0 },
  { label: "E", bearing: 90 },
  { label: "S", bearing: 180 },
  { label: "W", bearing: 270 },
];

/** Converts a horizontal forward/look direction `(fx, fz)` (any magnitude —
 * only its angle matters) into a compass bearing, per the world convention
 * above: bearing = atan2(fx, fz), normalized to [0, 360). */
export function bearingFromForward(fx: number, fz: number): BearingDegrees {
  const deg = (Math.atan2(fx, fz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Converts a player/camera `Rotation.yaw` (radians, the `sync.ts`/
 * `input.ts` convention where forward = `(-sin(yaw), 0, -cos(yaw))`) into a
 * compass bearing. Equivalent to `bearingFromForward(-sin(yaw), -cos(yaw))`,
 * exposed separately since this is the common case (the player's own
 * facing) and callers already holding a yaw shouldn't have to re-derive the
 * forward vector themselves. */
export function bearingFromYaw(yaw: number): BearingDegrees {
  return bearingFromForward(-Math.sin(yaw), -Math.cos(yaw));
}

/** Where a compass-card label at fixed bearing `labelBearing` should be
 * drawn, `radius` px from the widget's center, given the widget currently
 * reads `currentBearing` at its fixed "forward" marker (see `Compass.tsx`'s
 * doc comment for the handheld-compass-card metaphor this implements: the
 * card itself rotates opposite the viewer's heading, while the "forward"
 * mark stays fixed). Returns a pixel offset from center — `0,0` is center,
 * `0,-radius` is straight up. */
export function compassLabelOffset(labelBearing: BearingDegrees, currentBearing: BearingDegrees, radius: number): { x: number; y: number } {
  const rad = ((labelBearing - currentBearing) * Math.PI) / 180;
  return { x: radius * Math.sin(rad), y: -radius * Math.cos(rad) };
}
