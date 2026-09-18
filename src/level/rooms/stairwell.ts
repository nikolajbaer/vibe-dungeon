import type { RoomContent } from "../placementTypes";

// The stairwell wing (issue #86) — the level's first vertical connection,
// and its west branch off the main corridor: `corridor.ts`'s crossroads
// retrofit (`hallway_junction` -> `hallway_cross`) opened a new segment on
// the corridor's west face, directly opposite the existing east branch to
// `side-chamber.ts`'s crate/barrel room. This file places everything west
// of that opening: a short connecting corridor, a three-cell-long turret
// staircase up to floor 1, a small landing hub, and four small "nook" rooms
// fanning out from that hub — one per compass direction, per the design
// pillars' "give the map actual shape" pillar, one level up.
//
// All of this deliberately runs *away* from the existing map (west, into
// open space) rather than trying to route around anything that already
// exists, per the corridor-branch coordinates specified for this work.
//
// ## World layout (cell coordinates, not meters — multiply by UNIT=3 for
// world meters; see docs/LEVEL_DESIGN.md's "How to add a new tile instance"
// on why cell-space is the easier way to reason about placement)
//
// - `west-corridor` (`hallway`, rotation 90): cells (-3,-2), (-2,-2),
//   (-1,-2) on floor 0. Opens east into the crossroads' new west opening at
//   (0,-2), and west into `stair_lower`.
// - `stair_lower` (floor 0) / `stair_upper` (floor 1): **the same**
//   `originCell` {x:-6, z:-2}, a 3-cell-long (9m) shaft — see
//   `stairBuilder.ts`'s `STAIR_RUN_CELLS` doc comment for why 9m over
//   `FLOOR_RISE`'s 6m (a real, Playwright-verified climbable angle) rather
//   than a shorter, steeper run. `stair_lower` opens east (into
//   `west-corridor`'s far end at (-4,-2)); `stair_upper` opens west (into
//   `upper-landing`). The `stairs` entry below is what actually builds the
//   climbable ramp between them (`stairBuilder.ts`) — see
//   `stair_lower.ts`/`stair_upper.ts` for why the pair needs to skip their
//   own ceiling/floor slabs respectively for that shaft to have anywhere to
//   go.
// - `upper-landing` (`upper_landing`, floor 1): originCell {x:-8, z:-3}, a
//   6m x 6m hub with five connections — see that type's own doc comment for
//   exactly which of its eight perimeter segments are open. One connects
//   back to the stairs (east); the other four each lead to one `nook`.
// - Four `nook` instances (floor 1), one per compass direction off the hub:
//   `upper-room-south` (rotation 180, opens north into the hub's south
//   segment), `upper-room-north` (rotation 0, opens south into the hub's
//   north segment), and two rooms off the hub's west side, stacked along z
//   — `upper-room-west-1` (rotation 90, opens east into the hub's
//   near-south west segment) and `upper-room-west-2` (rotation 90, opens
//   east into the hub's near-north west segment).
//
// `stair_lower`/`stair_upper` share the `"stairwell"` sector — deliberate,
// not an oversight: `sectorAt` (occupancy.ts) picks a floor from the
// player's Y via `floorForY`, which rounds rather than floors specifically
// so a position partway up a real staircase doesn't need to resolve to
// exactly the "right" side of that rounding — see `floorForY`'s doc comment
// in tiles.ts. Giving both landings the same sector id means it doesn't
// matter either way while genuinely mid-climb.
//
// No aggressive NPCs are placed anywhere in this wing (see `NpcSpawn.floor`'s
// doc comment on why an aggressive archetype's XZ-only aggro check is worth
// double-checking before adding one near another) — this wing is quiet by
// design, proving vertical traversal rather than adding a new encounter.
//
// ## Dormitory furnishing pass (expand-upstairs-into-a-dormitory task)
//
// The four nooks were originally left bare on purpose (see the props
// comment further down) -- this pass furnishes them as a dormitory, without
// touching the wing's tiles/layout at all (still four bare 3m x 3m rooms
// off one hub, still no aggressive NPC anywhere up here). Each nook is only
// ~2.7m x 2.7m clear once wall thickness is subtracted, so each gets at
// most a bed plus one more piece (a chest or the bookshelf), not both, to
// avoid cramming a tiny room:
//
// - `upper-room-south` / `upper-room-north`: bed + chest (the chest gives a
//   dormitory chest some starter loot -- see its own `contents` below,
//   `docs/LEVEL_DESIGN.md`'s "how to add a container" section covers a
//   furniture container's `contents` the same way a barrel's works).
// - `upper-room-west-1`: bed + bookshelf, for a "someone reads in here"
//   variant rather than three identical bedrooms.
// - `upper-room-west-2`: bed only -- kept quiet/sparse on purpose (pacing
//   pillar), the same "not every room needs everything" reasoning the
//   original bare-nooks design used, just one notch less bare.
//
// Every bed is placed headboard-to-the-back-wall, foot toward the nook's one
// doorway (an open archway, not a hinged door -- `nook`'s face is
// `"opening"`, so there's no swing arc to route furniture around, unlike a
// great_hall door). Static props' collision footprint (`addPropCollider` in
// level/spawning.ts) is an axis-aligned box taken from the asset's
// unrotated `hx`/`hz` regardless of a placement's own `rotation` -- an
// existing simplification this pass doesn't change, so every placement below
// keeps generous (>0.5m) clearance from walls/other furniture rather than
// relying on exact rotated-box math.

const stairwell: RoomContent = {
  tiles: [
    {
      id: "west-corridor",
      tileTypeId: "hallway",
      originCell: { x: -3, z: -2 },
      rotation: 90,
      sectorId: "west-corridor",
    },
    {
      id: "stair-lower",
      tileTypeId: "stair_lower",
      originCell: { x: -6, z: -2 },
      rotation: 0,
      sectorId: "stairwell",
      floor: 0,
    },
    {
      id: "stair-upper",
      tileTypeId: "stair_upper",
      originCell: { x: -6, z: -2 },
      rotation: 0,
      sectorId: "stairwell",
      floor: 1,
    },
    {
      id: "upper-landing",
      tileTypeId: "upper_landing",
      originCell: { x: -8, z: -3 },
      rotation: 0,
      sectorId: "upper-landing",
      floor: 1,
    },
    {
      id: "upper-room-south",
      tileTypeId: "nook",
      originCell: { x: -8, z: -4 },
      rotation: 180,
      sectorId: "upper-room-south",
      floor: 1,
    },
    {
      id: "upper-room-north",
      tileTypeId: "nook",
      originCell: { x: -8, z: -1 },
      rotation: 0,
      sectorId: "upper-room-north",
      floor: 1,
    },
    {
      id: "upper-room-west-1",
      tileTypeId: "nook",
      originCell: { x: -9, z: -3 },
      rotation: 90,
      sectorId: "upper-room-west-1",
      floor: 1,
    },
    {
      id: "upper-room-west-2",
      tileTypeId: "nook",
      originCell: { x: -9, z: -2 },
      rotation: 90,
      sectorId: "upper-room-west-2",
      floor: 1,
    },
  ],
  // The physical staircase connecting `stair-lower` (floor 0) to
  // `stair-upper` (floor 1) — see `StairConnector`'s doc comment
  // (placementTypes.ts) for the axis/direction convention. Climbing runs
  // toward -x (`direction: -1`): entering `stair-lower` from the corridor at
  // its east end (cell -4) and climbing toward its west end (cell -6),
  // which is exactly where `stair-upper`'s own west opening continues into
  // `upper-landing` one floor up — one continuous direction of travel from
  // corridor to landing.
  stairs: [{ x: -6, z: -2, floorBelow: 0, floorAbove: 1, axis: "x", direction: -1 }],
  // One bespoke decorative touch (docs/LEVEL_DESIGN.md's pacing pillar) in
  // the landing hub, centered well clear of all five doorways; the four
  // nooks stay bare — proving the vertical traversal works is the point of
  // this wing, not filling every room with set dressing (see the task's own
  // "bare-but-correct is fine" allowance).
  props: [
    { id: "candelabra", x: -21, z: -6, floor: 1 },

    // upper-room-south (world x[-24,-21], z[-12,-9], archway on its north
    // edge z=-9) -- bed against the south (back) wall, foot toward the
    // archway; chest tucked by the east wall, clear of the bed's own x
    // extent ([-23,-22]) regardless of z.
    { id: "bed", x: -22.5, z: -10.75, rotation: 0, floor: 1 },
    { id: "chest", x: -21.7, z: -10.0, rotation: -Math.PI / 2, floor: 1, contents: [{ id: "coin", count: 8 }] },

    // upper-room-north (world x[-24,-21], z[-3,0], archway on its south edge
    // z=-3) -- bed against the north (back) wall, foot toward the archway;
    // chest by the east wall, same east-wall/clear-of-bed reasoning as above.
    { id: "bed", x: -22.5, z: -1.25, rotation: Math.PI, floor: 1 },
    { id: "chest", x: -21.7, z: -1.0, rotation: -Math.PI / 2, floor: 1, contents: ["gem"] },

    // upper-room-west-1 (world x[-27,-24], z[-9,-6], archway on its east
    // edge x=-24) -- bed against the west (back) wall, foot toward the
    // archway; bookshelf against the north wall, clear of the bed's own z
    // extent ([-8,-7]).
    { id: "bed", x: -25.95, z: -7.5, rotation: Math.PI / 2, floor: 1 },
    { id: "bookshelf", x: -25.0, z: -6.34, rotation: Math.PI, floor: 1 },

    // upper-room-west-2 (world x[-27,-24], z[-6,-3], archway on its east
    // edge x=-24) -- bed only, kept sparse (see header comment).
    { id: "bed", x: -25.95, z: -4.5, rotation: Math.PI / 2, floor: 1 },
  ],
};

export default stairwell;
