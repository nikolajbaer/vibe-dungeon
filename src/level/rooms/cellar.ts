import type { RoomContent } from "../placementTypes";

// The cellar wing (bandit-relocation task) — the level's first *downward*
// vertical connection, branching off room-b's new east wall opening (see
// `rooms/room-b.ts`'s header comment for exactly which world cell that
// lands on and why `great_hall_branch`, not `great_hall` itself, was the
// type that needed to change). This is the mirror image of
// `rooms/stairwell.ts`'s floor-0-to-floor-1 climb: same mechanism
// (`StairConnector` + a `stair_lower`/`stair_upper` tile pair sharing one
// `originCell` on two floors), opposite sign (floor 0 down to floor -1
// instead of floor 0 up to floor 1). See `tiles.ts`'s `floorForY` for the
// one piece of shared plumbing this genuinely needed fixing first (it used
// to hard-clamp to floor 0, which would have silently misreported every
// position down here).
//
// ## World layout (cell coordinates; multiply by UNIT=3 for world meters)
//
// - `cellar-stair-upper` (`stair_upper`, floor 0) / `cellar-stair-lower`
//   (`stair_lower`, floor -1): **the same** `originCell` {x:2, z:-5}, a
//   3-cell shaft. A type's name describes which *end of a shaft* it
//   is (skips its own floor or ceiling slab so the shaft has somewhere to
//   go — see each type's own doc comment), not which literal floor numbers
//   it connects, so the exact same pair works for any adjacent floor
//   difference. Here `stair_upper` (skips its floor slab, opens **west**)
//   is the shaft's *top* terminus, placed at `floor: 0` — the numerically
//   higher floor, same relationship to `stair_lower` as in the upstairs
//   wing, just now the "upstairs" side happens to be the original ground
//   floor rather than floor 1. `stair_lower` (skips its ceiling slab, opens
//   **east**) is the shaft's *bottom* terminus, at `floor: -1`. Its east
//   opening meets `cellar-room`'s own west door.
// - `cellar-room` (`cellar_room`, floor -1): originCell {x:5, z:-5}, a 6m x
//   6m room (see that type's own doc comment for why it's a dedicated type
//   rather than a reused `side_chamber`) whose single west door (local
//   index 0, world cell (5,-5)'s negX face) meets `stair-lower`'s east
//   opening at world cell (4,-5)'s posX face — both at the x=4/5 boundary,
//   z=-5 (world meters x=15, z in [-15,-12]).
//
// `stair-upper`/`stair-lower` share the `"cellar-stairs"` sector, same
// reasoning as the upstairs wing's shared `"stairwell"` sector (`floorForY`
// rounds a mid-climb Y to whichever floor is nearer, so sharing one sector
// id between the two landings makes which side of that rounding a climbing
// player falls on not matter for sector tracking).
//
// The bandit that used to guard room-b (issue #70's "first aggressive
// archetype") moved down here — same archetype and gem loot, plus the dagger
// visible in his hand, just relocated to be the dungeon's actual final encounter rather
// than the first room behind a locked door. `cellar-room` is otherwise kept
// deliberately sparse and undecorated (a couple of crates, no banners/
// candelabra/tables) — this should read as neglected and forgotten, the
// opposite of room-a/room-b's furnished "someone lives here" feel, matching
// the warning poster upstairs (`rooms/room-b.ts`) that says not to come
// down here. No lock/gate on the stairs themselves — the warning is purely
// narrative, per the task this shipped with; a curious player can always
// just walk down.

const cellar: RoomContent = {
  tiles: [
    {
      id: "cellar-stair-upper",
      tileTypeId: "stair_upper",
      originCell: { x: 2, z: -5 },
      rotation: 0,
      sectorId: "cellar-stairs",
      floor: 0,
    },
    {
      id: "cellar-stair-lower",
      tileTypeId: "stair_lower",
      originCell: { x: 2, z: -5 },
      rotation: 0,
      sectorId: "cellar-stairs",
      floor: -1,
    },
    {
      id: "cellar-room",
      tileTypeId: "cellar_room",
      originCell: { x: 5, z: -5 },
      rotation: 0,
      sectorId: "cellar",
      floor: -1,
    },
  ],
  // Climbs toward -x (direction: -1) from the cellar (floorBelow) up to
  // room-b's own floor (floorAbove) -- same axis/sign convention as
  // stairwell.ts's own connector, just one floor pair down instead of up:
  // `stair_lower`'s (floor -1) opening is on its east end, `stair_upper`'s
  // (floor 0) opening is on its west end, so the climb's "up" direction
  // (toward floorAbove) runs from the shaft's east end to its west end,
  // i.e. toward -x, regardless of which two floor numbers are involved.
  stairs: [{ x: 2, z: -5, floorBelow: -1, floorAbove: 0, axis: "x", direction: -1 }],
  // z=-13 keeps the bandit close to the shaft's own centerline (the ramp's
  // lateral band is roughly z in [-14.8,-12.2] -- see stairBuilder.ts's
  // `STAIR_HALF_WIDTH` around `rampGeometryOf`'s `perpCoord`), so a player
  // descending the stairs walks essentially straight at it rather than
  // drifting sideways off the ramp partway down -- the same "on the spine
  // leading to the door" placement room-b's original bandit used.
  npcs: [{ id: "bandit", x: 18, z: -13.0, floor: -1, contents: ["gem", "dagger"] }],
  props: [
    // Sparse, neglected clutter -- clear of the door's swing arc (west
    // wall, z in [-15,-12]) and the bandit above.
    { id: "crate", x: 16.2, z: -9.6, rotation: 0.2, floor: -1 },
    { id: "crate", x: 20.5, z: -14.3, rotation: -0.3, floor: -1 },
  ],
};

export default cellar;
