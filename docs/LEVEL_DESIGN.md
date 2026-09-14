# Level design guide

Written for whoever (human or agent) builds the next piece of the dungeon.
Pitched at the same level of concreteness as the README's Design Notes: this
is a working reference for the tile system as it actually exists today, not
generic level-design advice. Read `src/level/tiles.ts`, `src/level/occupancy.ts`,
and `src/level/levelData.ts` alongside this doc — it points at line-level
specifics rather than restating the whole files.

## Design pillars

Starting point for anyone shaping the map — refine these as the game grows,
don't treat them as fixed law:

1. **Exploration and combat, not puzzles or narrative.** This is an *Ultima
   Underworld*-spirit dungeon crawler. A room's job is to be worth walking
   into and (sometimes) worth fighting in — not to gate progress behind a
   lever/switch puzzle or deliver dialogue. If a room needs more than a
   sentence of "why is this here," it's probably out of scope for now.
2. **Rooms should feel geographically distinct, not copy-pasted.** The
   original level (`room-a` → `corridor` → `room-b`, both rooms literally the
   same `great_hall` tile type) is the cautionary example, not a template:
   one shape, one size, one straight line. A level with real shape needs
   variety in at least one of: room footprint/height, path shape (a straight
   run vs. a branch vs. a loop), and what's actually inside (furniture vs.
   bare stone vs. a monster). Two rooms built from the same tile type in
   different places is fine and often good (reuse is cheap and consistent);
   two rooms that are *indistinguishable in feel* is the thing to avoid.
3. **Give the map actual shape.** A straight line has no choices in it. Aim
   for at least one of: a **branch** (a corridor that forks, so the player
   picks a direction), a **loop** (two paths that reconnect, so backtracking
   isn't the only way out), or a **dead-end detour** (a side room off the
   main path that isn't required, but rewards checking). The current
   limitation section below explains why the existing two tile types can't
   do any of this on their own.
4. **Pace combat / treasure / quiet beats — don't fill every room.** Not
   every room needs an NPC or an item. A room that's just good lighting and
   a prop or two, with nothing to fight and nothing to pick up, is doing its
   job if it makes the player feel like they're somewhere real between
   encounters. As a rough rule of thumb: not every room on a path needs a
   spawn; a quiet room between two "loud" ones (an NPC, a fight, treasure)
   reads as intentional pacing rather than an empty room you forgot to fill.
5. **Use `sectorId` meaningfully, on every instance.** Every tile instance
   already needs a `sectorId` for the format to work at all — pick it as if
   it will be used for gameplay, because it increasingly is (corpse cleanup,
   issue #59, already keys off it: a corpse despawns once the player leaves
   its death sector). Convention so far: one sector per room/corridor,
   named after the instance (`"room-a"`, `"corridor"`, `"room-b"`). Don't
   reuse a sector id across unrelated instances, and don't leave sub-areas
   of one physical room split across multiple sector ids for no reason —
   `sectorAt()` is a point lookup keyed by whichever instance occupies a
   given cell, so keep the id boundaries where you'd actually expect a
   "you've left the room" transition to happen.

## The tile system's actual rules

Authoritative source: README's "Tile-based level system" section, and the
comments in `tiles.ts`/`occupancy.ts` themselves. Summarized here with the
specific things that trip people up:

- **Unit = 3m.** The world grid is integer cells `(x, z)` (`y` is height,
  handled separately) — every cell is a 3m × 3m footprint. `UNIT` in
  `tiles.ts` is the single source of truth; never hardcode `3`.
- **A tile *type*** (`TileType` in `tiles.ts`) is shared, reusable data: a
  footprint `{w, d, h}` in cells (width × depth × height — `h` sets ceiling
  height only, not floor offset; see "Floors stay at a single baseline"
  below) plus a **face map** (`faces: Record<Side, FaceKind[]>`). The face
  map says, for every unit-cell segment around the unrotated perimeter,
  whether that segment is `"wall"`, `"opening"` (a permanently open gap —
  no door entity, just no wall), or `"door"` (an interactable double-door,
  built by `tileBuilder.ts`'s `addDoorPair`). `faces.north`/`faces.south`
  have length `w` (indexed by local x, increasing); `faces.east`/`faces.west`
  have length `d` (indexed by local z, increasing).
- **Every door/opening is exactly one unit-cell segment wide (3m), never
  more.** This isn't a runtime-checked rule — it falls directly out of the
  face map's shape (one `FaceKind` per segment). A wide room's wall can
  still have up to `w` (or `d`) independent connection points, one per
  segment, each independently a wall, an opening, or a door — see
  `GREAT_HALL`'s south face, `["wall", "door", "wall"]`, a 3-segment array
  with the door only in the middle.
- **A face map is fixed per type, not per instance.** There is currently
  **no way to override one segment's `FaceKind` for a single instance** —
  every instance of a type shares that type's exact face map (rotated, per
  instance, but not otherwise edited). This matters a lot in practice: see
  "Current limitation" below.
- **A tile *instance*** (`TileInstance` in `occupancy.ts`) places a type in
  the world: `{ id, tileTypeId, originCell: {x, z}, rotation, sectorId }`.
  `rotation` is one of `0 | 90 | 180 | 270`, applied counter-clockwise
  looking down +Y. `originCell` is the **min-corner cell of the footprint
  after rotation is applied** — at 90°/270° a `w × d` type occupies a
  `d × w` footprint in world cells, so `originCell` means something
  different at those rotations than at 0°/180° (same `w × d` footprint,
  just axes/segments relabeled — see "How rotation works" below).
- **Occupancy index + load-time validation.** `buildOccupancyIndex()`
  rotates every instance's face map into world-axis-aligned per-cell sides
  and indexes them by `"x,z"` world cell. `validateOccupancy()` then walks
  every occupied cell and checks each of its 4 neighbor directions:
  - A wall/opening/door facing an **occupied neighbor cell** must match
    that neighbor's facing side exactly on open-vs-wall (`"opening"` and
    `"door"` both count as "open" for this check — a level author can put
    the actual `"door"` `FaceKind` on whichever of the two tile types
    declares that connection, and it still renders as one working door
    either way, since `tileBuilder.ts`'s `combineKind()` picks `"door"`
    over `"opening"` when the two sides disagree).
  - A wall/opening/door facing **empty space** (no instance placed there)
    must be `"wall"` — an `"opening"`/`"door"` facing nothing throws
    immediately, with a message naming the offending instance and cell.
  - Two instances claiming the same cell throws too (an overlap error).

  This runs automatically at level load (`level.ts`'s `buildLevel()`, before
  any geometry is built) — get a face map wrong and you get a thrown `Error`
  with a specific cell/instance/direction in it, not a silent visual bug.
  Always let this run (don't catch/suppress it) when authoring new tiles;
  it's the whole point of the format.
- **Floors stay at a single baseline for v1.** A tile's `h` sets ceiling
  height (via `UNIT * h`), never a floor offset — every tile's floor is at
  world `y ≈ 0`. Stairs/multi-level height is explicitly out of scope for
  now (a real future feature, not a hack to bolt on here).
- **Torches are automatic, not authored.** `tileBuilder.ts` decides torch
  placement itself, per tile *instance*, from the already-built wall
  segments — nothing in `tiles.ts`/`levelData.ts` places a torch directly.
  A tile instance is "room-sized" (torch-eligible) when its **type's**
  unrotated `w > 1 && d > 1` (`isRoomSizedTileType()`) — a 1-wide corridor
  never qualifies, regardless of rotation or length. Up to
  `TORCHES_PER_ROOM` (currently 2) segments are picked per eligible
  instance, spread apart by taking from opposite ends of that instance's
  wall-segment list. **You don't need to do anything to get torches in a
  new room** — just make sure its tile type's footprint is `w > 1 && d > 1`
  (a 1-wide hallway-style type never gets them, by design) and confirm by
  actually looking at the rendered result once it's built (see Verification
  in the issue this doc came out of — this is the kind of thing that's easy
  to assume works and not actually check).

## Current limitation, worth knowing before you design anything

**As of today, neither existing tile type can branch a path in more than
one direction on its own:**

- `GREAT_HALL` (the only room type) has exactly **one** door — the middle
  segment of its south face (`faces.south = ["wall", "door", "wall"]`).
  North, east, and west are `wallsOf(3)`, solid. Two `great_hall` instances
  facing each other (`room-a` / `room-b`, the latter rotated 180°) is the
  *only* way the current level uses this type, and it's inherently a
  straight line: the door is the only opening this type has, period.
- `HALLWAY` opens **only** north/south (`faces.north = faces.south =
  ["opening"]`); both east and west are solid walls the entire 9m length
  (`wallsOf(3)` on each side). Rotating a hallway instance 90° just changes
  *which world axis* "north/south" maps to — it never adds a side opening.
  A hallway can extend a straight line or turn a corner (by placing a
  second, rotated hallway/room at its open end) but it cannot fork.

**The practical consequence: you cannot add a branch, loop, or side room
anywhere in the current three-instance level without either (a) defining a
new tile type with a different face map, or (b) giving an *existing*
instance a type with an extra opening.** There is no per-instance face
override (see above) — every instance of a shared type gets that type's
exact face map. This is exactly the situation this doc's companion PR
solves: see "Worked example" below for how the first branch was actually
added, including which of (a)/(b) it used and why.

If you only ever add brand-new rooms chained onto brand-new corridors, this
limitation won't bite you (each new type/instance can be shaped however you
like from the start). It bites the moment you want to branch *off* an
already-placed straight run — which is exactly when a level starts feeling
less like a hallway and more like a dungeon.

## How rotation works (worked from the existing level)

`room-b` (`levelData.ts`) is the existing example: same `great_hall` type as
`room-a`, `rotation: 180`. `GREAT_HALL`'s door is on its local **south**
face; a 180° rotation maps local south → world north (and local north →
world south, local east ↔ local west) — see `rotateOnce()` in
`occupancy.ts` for the exact per-cell-side mapping it's built from. So
`room-b`'s door ends up facing world **north**, back toward the corridor —
same tile type, opposite effective orientation, zero duplicated face-map
data. This is the intended way to get a mirrored/reoriented room: rotate an
existing type rather than authoring a near-duplicate type that only differs
by which side the door is on.

Rotation is always in 90° steps; at 90°/270° a `w × d` footprint becomes
`d × w` in world cells (a corridor's long axis literally swaps between x and
z), which is how a single `HALLWAY` instance can run either north-south (its
unrotated orientation) or east-west (rotated 90°/270°) without a second
type.

## How to add a new tile type

1. Open `src/level/tiles.ts`. Decide the unrotated footprint: `w` (local x,
   cells), `d` (local z, cells), `h` (ceiling height, cells — `UNIT * h`
   meters).
2. Write the face map: `faces.north`/`faces.south` need exactly `w` entries
   each (indexed by local x, increasing); `faces.east`/`faces.west` need
   exactly `d` entries each (indexed by local z, increasing). Every entry is
   `"wall"`, `"opening"`, or `"door"`. Use the `wallsOf(n)` helper for an
   all-solid side. Put a door/opening only where you actually intend
   something to connect — every open segment must eventually border either
   another instance's matching open segment, or nothing at all (which will
   throw at load time, on purpose, until you place the other side).
3. Add it to the `TILE_TYPES` registry at the bottom of the file (the
   `[TYPE.id]: TYPE` pattern already there) — instances reference types by
   `id` string, and an unknown id throws at load time too.
4. Write a doc comment on the exported const in the same style as
   `HALLWAY`/`GREAT_HALL` — footprint, ceiling height, and where its
   doors/openings are, in plain language. The face-map arrays alone aren't
   self-explanatory to the next reader.

You do **not** need to touch `occupancy.ts` — rotation, validation, and the
occupancy index are all generic over whatever's in `TILE_TYPES`.

## How to add a new tile instance

1. Open `src/level/levelData.ts`. Pick a `tileTypeId` (existing or one you
   just added), a `rotation`, and an `originCell`.
2. Work out `originCell` by whichever existing instance you're attaching
   to: find the world cell(s) of the open face you're connecting into, then
   place your new instance so its **own** open face (after rotation) lands
   on the matching adjacent cell(s) with the opposite-facing side. It's
   easiest to reason about this in world cells (`x, z` integers, each
   `UNIT` meters) rather than meters — convert to meters (`cell * UNIT`)
   only when you need a real-world position (e.g. for `LEVEL_SPAWN`, or
   hand-placed content in `game.ts`/`decorations.ts`).
3. Give it a unique `id` (used in `validateOccupancy` error messages and by
   `sectorAt`'s corpse-cleanup consumer indirectly, via `sectorId`) and a
   `sectorId` — new sector, unless this instance is genuinely a sub-area of
   an existing sector's same room.
4. Run the level through `validateOccupancy` before assuming it's right —
   there's no test harness for this yet, so the fastest local check is a
   throwaway script:
   ```ts
   import { buildOccupancyIndex, validateOccupancy } from "./src/level/occupancy";
   import { LEVEL_TILES } from "./src/level/levelData";
   validateOccupancy(buildOccupancyIndex(LEVEL_TILES)); // throws on any mismatch
   ```
   run with `npx tsx <script>.ts`. It throws with the exact cell/instance/
   direction of the first mismatch, so a bad face map is fast to fix. This
   is a good candidate to promote into a real repeatable check (a small
   Vitest/Node test) next time someone touches this area — nothing like
   that exists yet.
5. Actually render it and walk through it (Playwright or by hand) before
   calling it done — validation only catches face-map mismatches, not "this
   room is floating," "this door opens into a wall," or "no torches showed
   up because the footprint is 1-wide." See the Verification section of the
   issue that produced this doc for the specific things to check.
6. If the new instance is room-sized (`w > 1 && d > 1` on its type),
   torches are automatic — verify they actually appear rather than assuming
   it from reading the code. If you want a bespoke decorative touch beyond
   torches, add a small dedicated function in `src/level/decorations.ts`
   (same pattern as `addDecorations()`'s furniture group) and call it once
   from `addDecorations()` — keep new decoration code in its own function
   rather than growing the existing one in place, so unrelated level-art
   work doesn't collide on the same lines.

## Worked example: the first branch off the original line

This is what shipped alongside this doc (see `levelData.ts`/`tiles.ts`),
included here as a concrete instance of the walkthrough above, and as the
answer to the "current limitation" section: **how do you branch off an
already-placed straight run when neither existing type supports it and
there's no per-instance face override?**

The corridor (`corridor`, type `HALLWAY`) was the lowest-risk place to
retrofit: unlike `room-a`/`room-b`, no hardcoded coordinate-anchored content
(`game.ts`'s player spawn/NPC/items, `decorations.ts`'s furniture) lives
inside it, so giving it an extra opening can't disturb anything else. A new
type, `HALLWAY_JUNCTION` (`tiles.ts`), copies `HALLWAY`'s exact footprint and
north/south openings and adds one more: a `"opening"` on the middle segment
of its east face. The `corridor` instance's `tileTypeId` was then changed
from `"hallway"` to `"hallway_junction"` — its `id`, `originCell`,
`rotation`, and `sectorId` are all untouched, so nothing coordinate-anchored
moved and both original doors (`room-a`'s and `room-b`'s) keep working
exactly as before; the only observable change is one new gap in a
previously fully-solid side wall. **This is the general technique for
branching off an existing straight run**: define a new type that's a
strict superset of the old one's openings (same connections, plus the new
one), then swap the instance's `tileTypeId` to it — never touch
`originCell`/`rotation` on an instance something else depends on
positionally.

From that new opening, a `HALLWAY` instance rotated 90° runs the branch
east (reusing the existing type — a rotated hallway is still a hallway),
ending in a new room type, `SIDE_CHAMBER` (`w=2, d=2, h=1` — deliberately
smaller and lower-ceilinged than `GREAT_HALL`'s `3×3×2`, so it reads as a
distinct kind of space rather than a smaller copy of the great hall), with
a single door on its west face meeting the branch corridor. The player now
gets a real choice at the junction: continue straight to `room-b`, or turn
off into the side chamber. `SIDE_CHAMBER` is room-sized (`w,d > 1`) so it
picks up torches automatically; it also gets one bespoke decorative touch
(see `decorations.ts`) for the "distinct feel" pillar.
