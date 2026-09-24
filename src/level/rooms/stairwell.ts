import type { RoomContent } from "../placementTypes";

// The stairwell wing (issue #86) — the level's first vertical connection,
// and its west branch off the main corridor: `corridor.ts`'s crossroads
// retrofit (`hallway_junction` -> `hallway_cross`) opened a new segment on
// the corridor's west face, directly opposite the existing east branch to
// `side-chamber.ts`'s crate/barrel room. This file places everything west
// of that opening: a short connecting corridor, a three-cell-long turret
// staircase up to floor 1, a small landing hub, and (dormitory-expansion
// task) a proper dormitory fanning north and south off that hub.
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
//   exactly which of its eight perimeter segments are open: one connects
//   back to the stairs (east), two open onto `upper-room-west-1`/`-2` (west,
//   unchanged from the wing's original build), and one each opens north and
//   south into the two new dormitory corridors below — the hub's own face
//   map didn't need to change at all for this expansion, since it already
//   had exactly one north and one south connection point; only what's
//   attached on the other side of each changed (a direct `nook` before,
//   `dorm_corridor` now).
//
// ## Dormitory expansion (dormitory-expansion task): a corridor of four
// rooms each, north and south, capped with a latrine
//
// Both wings are built the same way, mirrored across the hub: a single
// `dorm_corridor` instance (`dorm_corridor.ts`, 1x4 cells, open at both
// ends, one `"singleDoor"` per cell on its west face) runs from the hub
// out to a capping latrine, with a `nook`-reused bedroom on the west side
// of each of its four cells.
//
// - `dorm-corridor-north` (`dorm_corridor`, unrotated): originCell
//   {x:-8, z:-1}, cells (-8,-1)..(-8,2). Its south end (local z=0) meets the
//   hub's own north opening; its north end (local z=3) meets
//   `dorm-latrine-north`. Both ends are plain `"opening"`s on this type
//   (rotation doesn't matter for which literal direction is "north" here —
//   see `dorm_corridor.ts`'s own doc comment).
// - Four bedrooms, `nook` rotated 90 (opens east, the same rotation
//   `upper-room-west-1`/`-2` already use to open east toward the hub) at
//   cell x=-9, one per corridor cell: `dorm-room-n1` (z=-1) through
//   `dorm-room-n4` (z=2).
// - `dorm-latrine-north` (`nook`, unrotated — opens south, meeting the
//   corridor's own north end): cell (-8, 3).
//
// - `dorm-corridor-south` (`dorm_corridor`, unrotated): originCell
//   {x:-8, z:-7}, cells (-8,-7)..(-8,-4). Its north end (local z=3) meets
//   the hub's own south opening; its south end (local z=0) meets
//   `dorm-latrine-south`.
// - Four bedrooms, `nook` rotated 90, at cell x=-9: `dorm-room-s1` (z=-7)
//   through `dorm-room-s4` (z=-4).
// - `dorm-latrine-south` (`nook`, rotation 180 — opens north, the same
//   rotation the original `upper-room-south` used for the identical "opens
//   north toward whatever's north of it" need): cell (-8, -8).
//
// Every bedroom/latrine door is a `"singleDoor"` (see `nook.ts`'s own doc
// comment) — a real, closeable, human-scale door rather than the bare
// archways this wing originally used, per the "use a single door wherever a
// smaller room is on the other side" convention this task also introduced.
// The corridor itself gets no automatic torches (`dorm_corridor.ts` is
// `w=1`, never room-sized) and, matching this level's existing convention
// for plain corridors (`corridor.ts`/`training-corridor` also carry no
// manual light of their own), none are added here either — the level's
// baseline dim ambient/hemisphere light (`game.ts`, "never fully pitch
// black") is what every corridor in the level already relies on.
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
// ## Furnishing
//
// `upper-room-west-1`/`-2` keep their original bed/bookshelf loadout, but
// **not** their original bed orientation or offsets — this task's own
// "opening -> singleDoor" retrofit turned their once-decorative archway into
// a real hinged door with a real swept collider, and the original placement
// (bed rotated 90 degrees, its 2m length running east-west across the whole
// room) put the bed's own near edge almost flush against the doorway, well
// inside the open leaf's swept arc. Fixed here (for these two rooms and all
// eight new ones alike) by turning the bed the *other* way: unrotated
// (rotation 0), its short 1m width runs east-west instead, so it only
// reaches about a meter out from the back wall — comfortably short of the
// door (a `"singleDoor"` swings at most `SINGLE_DOOR_WIDTH` = 1m into the
// room, i.e. to about 1m in front of the doorway wall) regardless of which
// room it's in or how big the room's own footprint is. Its 2m length now
// runs north-south, which is what actually made room in the middle of the
// room's own short depth for a second furniture piece to sit *beside* the
// bed (not past it toward the door) without either one touching the swept
// door.
//
// Every bed sits at x=-26.3 (about a meter clear of the back/west wall),
// `z` = the room's own cell center; a second piece, where present, sits
// beside it (further toward the door, but still short of the swing) at
// x=-25.6, same `z`. Room-by-room:
//
// - `upper-room-west-1`: bed + bookshelf (kept from its original loadout).
// - `upper-room-west-2`: bed only (kept sparse, as originally built).
// - Two of the eight new bedrooms get a bed plus a starter-loot chest
//   (mirroring this wing's own original two chests — one seeded with coins,
//   one with a gem), two get a bed plus a bookshelf, and four are sparse,
//   bed only — the same "not every room needs everything" pacing pillar
//   `upper-room-west-1`/`-2` already established, just scaled up rather than
//   repeated eight identical times.
//
// Each latrine gets one `latrine-bench` (`assets/furniture/latrine-bench.ts`)
// against its own back wall — the north latrine's back wall is north (its
// door is on the south side), the south latrine's back wall is south (its
// door is on the north side).

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

    // --- Dormitory expansion: north wing ---
    {
      id: "dorm-corridor-north",
      tileTypeId: "dorm_corridor",
      originCell: { x: -8, z: -1 },
      rotation: 0,
      sectorId: "dorm-corridor-north",
      floor: 1,
    },
    { id: "dorm-room-n1", tileTypeId: "nook", originCell: { x: -9, z: -1 }, rotation: 90, sectorId: "dorm-room-n1", floor: 1 },
    { id: "dorm-room-n2", tileTypeId: "nook", originCell: { x: -9, z: 0 }, rotation: 90, sectorId: "dorm-room-n2", floor: 1 },
    { id: "dorm-room-n3", tileTypeId: "nook", originCell: { x: -9, z: 1 }, rotation: 90, sectorId: "dorm-room-n3", floor: 1 },
    { id: "dorm-room-n4", tileTypeId: "nook", originCell: { x: -9, z: 2 }, rotation: 90, sectorId: "dorm-room-n4", floor: 1 },
    {
      id: "dorm-latrine-north",
      tileTypeId: "nook",
      originCell: { x: -8, z: 3 },
      rotation: 0,
      sectorId: "dorm-latrine-north",
      floor: 1,
    },

    // --- Dormitory expansion: south wing ---
    {
      id: "dorm-corridor-south",
      tileTypeId: "dorm_corridor",
      originCell: { x: -8, z: -7 },
      rotation: 0,
      sectorId: "dorm-corridor-south",
      floor: 1,
    },
    { id: "dorm-room-s1", tileTypeId: "nook", originCell: { x: -9, z: -7 }, rotation: 90, sectorId: "dorm-room-s1", floor: 1 },
    { id: "dorm-room-s2", tileTypeId: "nook", originCell: { x: -9, z: -6 }, rotation: 90, sectorId: "dorm-room-s2", floor: 1 },
    { id: "dorm-room-s3", tileTypeId: "nook", originCell: { x: -9, z: -5 }, rotation: 90, sectorId: "dorm-room-s3", floor: 1 },
    { id: "dorm-room-s4", tileTypeId: "nook", originCell: { x: -9, z: -4 }, rotation: 90, sectorId: "dorm-room-s4", floor: 1 },
    {
      id: "dorm-latrine-south",
      tileTypeId: "nook",
      originCell: { x: -8, z: -8 },
      rotation: 180,
      sectorId: "dorm-latrine-south",
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
  props: [
    // One bespoke decorative touch in the landing hub itself, centered well
    // clear of all five doorways.
    { id: "candelabra", x: -21, z: -6, floor: 1 },

    // upper-room-west-1 (world x[-27,-24], z[-9,-6], door on its east edge
    // x=-24) -- bed against the west (back) wall (unrotated -- see header
    // comment for why), bookshelf beside it, both clear of the door's own
    // swept arc.
    { id: "bed", x: -26.3, z: -7.5, rotation: 0, floor: 1 },
    { id: "bookshelf", x: -25.6, z: -7.5, rotation: 0, floor: 1 },

    // upper-room-west-2 (world x[-27,-24], z[-6,-3]) -- bed only, kept
    // sparse (see header comment).
    { id: "bed", x: -26.3, z: -4.5, rotation: 0, floor: 1 },

    // --- North wing bedrooms (world x[-27,-24], z per room below) -- every
    // bed at x=-26.3 (unrotated), a second piece where present at x=-25.6,
    // same z -- see header comment for why this orientation replaces the
    // wing's original one. ---
    // dorm-room-n1 (z[-3,0]): bed + starter-loot chest (8 coins).
    { id: "bed", x: -26.3, z: -1.5, rotation: 0, floor: 1 },
    { id: "chest", x: -25.6, z: -1.5, rotation: 0, floor: 1, contents: [{ id: "coin", count: 8 }] },
    // dorm-room-n2 (z[0,3]): bed + bookshelf.
    { id: "bed", x: -26.3, z: 1.5, rotation: 0, floor: 1 },
    { id: "bookshelf", x: -25.6, z: 1.5, rotation: 0, floor: 1 },
    // dorm-room-n3 (z[3,6]): bed only.
    { id: "bed", x: -26.3, z: 4.5, rotation: 0, floor: 1 },
    // dorm-room-n4 (z[6,9]): bed only.
    { id: "bed", x: -26.3, z: 7.5, rotation: 0, floor: 1 },

    // --- South wing bedrooms (world x[-27,-24], z per room below) ---
    // dorm-room-s1 (z[-21,-18]): bed + starter-loot chest (a gem).
    { id: "bed", x: -26.3, z: -19.5, rotation: 0, floor: 1 },
    { id: "chest", x: -25.6, z: -19.5, rotation: 0, floor: 1, contents: ["gem"] },
    // dorm-room-s2 (z[-18,-15]): bed + bookshelf.
    { id: "bed", x: -26.3, z: -16.5, rotation: 0, floor: 1 },
    { id: "bookshelf", x: -25.6, z: -16.5, rotation: 0, floor: 1 },
    // dorm-room-s3 (z[-15,-12]): bed only.
    { id: "bed", x: -26.3, z: -13.5, rotation: 0, floor: 1 },
    // dorm-room-s4 (z[-12,-9]): bed only.
    { id: "bed", x: -26.3, z: -10.5, rotation: 0, floor: 1 },

    // --- Latrines: one bench each, against the room's own back wall. ---
    // dorm-latrine-north (world x[-24,-21], z[9,12], door on the south edge
    // z=9) -- back wall is north (z=12); bench faces south into the room.
    { id: "latrine-bench", x: -22.5, z: 11, rotation: Math.PI, floor: 1 },
    // dorm-latrine-south (world x[-24,-21], z[-24,-21], door on the north
    // edge z=-21) -- back wall is south (z=-24); bench faces north into the
    // room (the default orientation, no rotation needed).
    { id: "latrine-bench", x: -22.5, z: -23, rotation: 0, floor: 1 },
  ],
};

export default stairwell;
