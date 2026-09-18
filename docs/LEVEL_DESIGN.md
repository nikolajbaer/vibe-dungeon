# Level design guide

Written for whoever (human or agent) builds the next piece of the dungeon.
Pitched at the same level of concreteness as the README's Design Notes: this
is a working reference for the tile system as it actually exists today, not
generic level-design advice. Read `src/level/tiles.ts`, `src/level/occupancy.ts`,
`src/level/tileTypeRegistry.ts`, and any file under `src/level/rooms/`
alongside this doc — it points at line-level specifics rather than
restating the whole files.

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
- **Floors can now sit at real height offsets (issue #86).** A tile's `h`
  still only sets *ceiling* height (via `UNIT * h`), never a floor offset —
  that part is unchanged. What's new is `TileInstance.floor` (default `0`,
  so every pre-#86 room, which never set it, keeps rendering at exactly the
  world position it always did): a whole-number floor index whose world Y
  baseline is `floorBaseline(floor)` (`tiles.ts`, `= floor * FLOOR_RISE`,
  `FLOOR_RISE` fixed at `2 * UNIT` = 6m, matching `great_hall`'s own 6m
  ceiling so an upstairs room reads at the same scale as the tallest room
  downstairs). The occupancy index's cell key folds `floor` in
  (`worldCellKey`, occupancy.ts), specifically so two tile instances can
  legitimately claim the *same* `(x, z)` cell as long as they're on
  different floors — the one deliberate use of this today is a staircase's
  two landings (see "Worked example: a vertical connection" below).
  `sectorAt` takes the position's Y too now and derives which floor a query
  actually means via `floorForY` (rounds `y / FLOOR_RISE` to the nearest
  floor) rather than trusting XZ alone, which matters the moment two floors
  share an XZ column. See the worked example below for the concrete
  mechanics — a new `TileType.skipFloorSlab`/`skipCeilingSlab` pair, and a
  `StairConnector` (`placementTypes.ts`) that builds the actual climbable
  geometry between two paired landings.
- **Torches are automatic, not authored.** `tileBuilder.ts` decides torch
  placement itself, per tile *instance*, from the already-built wall
  segments — nothing under `tileTypes/`/`rooms/` places a torch directly.
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

**Update (issue #86): multi-floor/stairs is no longer out of scope.** An
earlier version of this section (and of the README) flatly said floors stay
at a single baseline and stairs are future work. That's no longer true —
`TileInstance.floor`, `FLOOR_RISE`, and a `StairConnector` now give a real,
Playwright-verified way to place a second floor and a real climbable
staircase between them. See "The tile system's actual rules" above for the
mechanics and "Worked example: a vertical connection" below for how the
first one was actually built. The horizontal-branching limitation this
section is otherwise about is unchanged and unrelated — a vertical
connection has no face-map/opening concept at all (faces are north/south/
east/west only), so it doesn't interact with this limitation either way.

## How rotation works (worked from the existing level)

`room-b` (`src/level/rooms/room-b.ts`) is the existing example: same
`great_hall` type as `room-a`, `rotation: 180`. `great_hall`'s door is on its local **south**
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

Tile types are auto-discovered, one per file, the same way item/furniture
assets are (see the README's "Asset-authoring system" section) — you never
edit a shared registry.

1. Create `src/level/tileTypes/<your_id>.ts` (filename matches the type's
   `id`, snake_case — see `great_hall.ts`/`hallway_junction.ts` for the
   convention). Decide the unrotated footprint: `w` (local x, cells), `d`
   (local z, cells), `h` (ceiling height, cells — `UNIT * h` meters).
2. Write the face map: `faces.north`/`faces.south` need exactly `w` entries
   each (indexed by local x, increasing); `faces.east`/`faces.west` need
   exactly `d` entries each (indexed by local z, increasing). Every entry is
   `"wall"`, `"opening"`, or `"door"`. Import `wallsOf` from `../tiles` for
   an all-solid side. Put a door/opening only where you actually intend
   something to connect — every open segment must eventually border either
   another instance's matching open segment, or nothing at all (which will
   throw at load time, on purpose, until you place the other side).
3. Default-export the `TileType` const. That's the whole registration step
   — `src/level/tileTypeRegistry.ts` auto-discovers every file under
   `tileTypes/` (Vite's `import.meta.glob`) and throws at build time on a
   duplicate `id`; you never touch that file or any other tile type's file.
4. Write a doc comment on the const in the same style as
   `great_hall.ts`/`hallway_junction.ts` — footprint, ceiling height, and
   where its doors/openings are, in plain language. The face-map arrays
   alone aren't self-explanatory to the next reader.

You do **not** need to touch `occupancy.ts` — rotation, validation, and the
occupancy index are all generic over whatever's in `TILE_TYPES`.

## How to add a new tile instance

Tile instances (and everything else in a room — decorations, items) live in
one file per room/area under `src/level/rooms/`, auto-aggregated by
`src/level/rooms.ts` — the same file structure the README's
"Asset-authoring system" section describes for props/items. A room file
doesn't have to place exactly one physical room: `side-chamber.ts` places
both a corridor segment and the room it leads to, since they were authored
as one feature — group instances in a file however makes sense as one
piece of work.

1. Create (or open, if you're adding to an existing feature)
   `src/level/rooms/<your-room>.ts`, default-exporting a `RoomContent`
   (`src/level/placementTypes.ts`) with a `tiles: TileInstance[]` array.
   Pick a `tileTypeId` (existing or one you just added), a `rotation`, and
   an `originCell` for each instance.
2. Work out `originCell` by whichever existing instance you're attaching
   to: find the world cell(s) of the open face you're connecting into, then
   place your new instance so its **own** open face (after rotation) lands
   on the matching adjacent cell(s) with the opposite-facing side. It's
   easiest to reason about this in world cells (`x, z` integers, each
   `UNIT` meters) rather than meters — convert to meters (`cell * UNIT`)
   only when you need a real-world position (e.g. a `props`/`items` entry
   in the same file, or a `spawn`).
3. Give each instance a unique `id` (used in `validateOccupancy` error
   messages and by `sectorAt`'s corpse-cleanup consumer indirectly, via
   `sectorId`) and a `sectorId` — new sector, unless this instance is
   genuinely a sub-area of an existing sector's same room.
4. Run the level through `validateOccupancy` before assuming it's right —
   there's no test harness for this yet, so the fastest local check is a
   throwaway script:
   ```ts
   import { buildOccupancyIndex, validateOccupancy } from "./src/level/occupancy";
   import { ALL_TILE_INSTANCES } from "./src/level/rooms";
   validateOccupancy(buildOccupancyIndex(ALL_TILE_INSTANCES)); // throws on any mismatch
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
   torches, add entries to the same file's `props`/`items` arrays,
   referencing furniture/item asset ids by `id`, plus `x`/`z`/`rotation`/
   `params` — see any existing file under `rooms/` for the shape. If the
   furniture/item you want doesn't exist yet, add it as its own file under
   `src/assets/furniture/`/`src/assets/items/` first (see the
   "Asset-authoring system" section of the README) — same rule: a new
   file, not an edit to a shared registry. This is what keeps unrelated
   level-art work from colliding on the same lines: a new room/feature is
   one new file, and even decorating an *existing* room is a data edit
   inside that room's own file, not a shared placement function.

## How to lock a door

A door is already authored as a `"door"` `FaceKind` on some tile type's face
map (see above) — locking one doesn't add a door, it attaches lock data to
one that's already there, via a `LockedDoorSpec` (`placementTypes.ts`) in
the same room file that places the tiles, alongside `props`/`items`/etc.:

```ts
lockedDoors: [{ x: 0, z: -4, side: "posZ", requiredItemTypeId: "key" }],
```

`x`/`z`/`side` identify the door by the same (cell, direction) addressing
`tileBuilder.ts`'s wall/door emission already walks internally — not the
tile instance's `originCell`, and not the type's own *local* face label
(which a rotated instance maps to a different world side; see "How rotation
works" above). The straightforward way to find the right values for an
existing door: it's whichever cell the `"door"` face is authored on, and
whichever world-space side (`posX`/`negX`/`posZ`/`negZ`) faces the
neighboring room/corridor it opens into — `rooms/room-b.ts`'s own
`lockedDoors` entry works through this for a concrete, already-rotated
example. Get it wrong and the spec silently matches nothing (the door
builds as an ordinary unlocked one) rather than erroring, so confirm it
worked by checking `getDoorStates()`'s `locked` field via the debug hook
rather than assuming.

**One specific way to get it wrong, found building the training wing's
lockpicking nook:** for a boundary *shared* between two instances (as
opposed to one that faces empty space), `tileBuilder.ts`'s wall/door
emission only ever looks the lock data up from the boundary's "owner"
direction — `posX`/`posZ` (see `WALL_DIRS` in `tileBuilder.ts`; `negX`/
`negZ` are never the owner) — regardless of which of the two instances'
*type* actually declares the `"door"` face. `rooms/room-b.ts`'s own example
happens to already use an owner-direction side (`posZ`), which is why it
doesn't demonstrate this trap. Concretely: a door on `lock_nook`'s own
`negX` face, shared with a neighboring room to its west, has to be
addressed from *that neighbor's* cell and `posX` side, not from
`lock_nook`'s own cell and `negX` side — even though `negX` is the side the
`"door"` `FaceKind` is literally authored on. When a locked door's neighbor
is another placed instance (not empty space), try the *other* cell/side
first if the straightforward reading doesn't show up as locked.

## How to add a readable (a poster fixture or a pickupable scroll)

Both open the same paged reader (`notice/NoticePanel.tsx`) on the same
`Readable` component (`ecs/components.ts`), but differ in whether they can
be carried off — pick whichever fits the moment: a poster is read in place
where it's found, a scroll goes in the inventory to be re-read any time.

**Fixture (read in place, never carried)** — a `ReadablePlacement`
(`placementTypes.ts`) places a wall-mounted `"poster"` (a furniture asset,
`src/assets/furniture/`) that opens the reader on world interact, in a room
file's `readables` array:

```ts
readables: [
  {
    id: "poster",
    x: 5.7,
    z: 3.0,
    rotation: -Math.PI / 2, // every furniture asset builds facing local +z
    title: "Notice",        // omit for an anonymous scrap with no heading
    pages: ["First page text.", "Second page, if there is one."],
  },
],
```

**Pickupable item (carried, read from inventory)** — a `"scroll"` is a
normal `ItemAssetDef` (`src/assets/items/scroll.ts`), so it's placed in a
room file's `items` array like any other pickup, just with `title`/`pages`
added to the `ItemSpawn`:

```ts
items: [
  {
    id: "scroll",
    x: 17.5,
    z: -4.6,
    title: "Journal of the Watch",
    pages: ["First page text.", "Second page, if there is one."],
  },
],
```

Interacting with a scroll in the world always picks it up (never opens the
reader directly — see `tryInteract`/`dispatchInteract` in `doors.ts`);
tapping it afterward in the inventory list (`InventoryList.tsx`) is what
opens the reader.

Either way, unlike `ItemSpawn`/`PropPlacement`'s shared *type* data,
`title`/`pages` are the placement's own data — two posters (or two scrolls)
never say the same thing, so the text lives on the placement, not in a
registry (see `Readable`'s doc comment in `ecs/components.ts`). `pages`
with more than one entry gets an automatic next/prev-paged reader; a single
entry just shows that text and a Close button, like reading a sign.
There's no lock/key interaction on either kind — every readable is freely
readable any time, once found.

## How to add a container (a barrel with loot in it)

A furniture asset opts into being a lootable container via
`FurnitureAssetDef.container` (`src/assets/furniture/barrel.ts` is the only
one so far) — nothing to do per-placement for that part, every barrel is
already interactable. To give a *specific* placed barrel starting loot,
add `contents` (an array of `ContentsEntry` — either a bare `ItemAssetDef`
id, or `{ id, count }` for a stackable item, see below) to its
`PropPlacement` in a room file, alongside `x`/`z`/etc:

```ts
props: [
  { id: "barrel", x: 5.3, z: 8.4, contents: ["gem"] },
  // A stackable item (see "How to add a stackable/commodity item type"
  // below) needs the object form to say how many units the pile is worth.
  { id: "barrel", x: -2.3, z: -13.2, contents: [{ id: "coin", count: 15 }] },
],
```

Each entry spawns as a normal item, already carried by that barrel — the
player finds it already inside on first opening the barrel, exactly as if
someone had stored it there. `spawnProps` throws at load time if `contents`
is set on a placement whose furniture asset isn't a `container` (same "fail
loudly" philosophy as an unknown `id`), if any entry references an unknown
item id, or if a `count` is given for an item that isn't `stackable`. There's
no capacity check at authoring time — enough `contents` entries to exceed
the container's own `capacity` would just make it start full, which is a
level-design mistake to notice by playtesting, not something worth a
load-time error over.

## How to give an NPC loot (lootable corpses)

Same `contents` field, same shape, on an `NpcSpawn` instead:

```ts
npcs: [{ id: "bandit", x: 1.5, z: -13, contents: ["gem"] }],
```

Once that NPC is killed, interacting with its corpse opens the same loot
panel a container does (`ecs/systems/doors.ts`'s `tryInteract` — a dead NPC
is interactable specifically for this, where a living one isn't), pre-seeded
with whatever `contents` named. Unlike a container, looting is take-only —
there's no "give" side, so items can't be left on a body. `spawnNpcs` throws
at load time for an unknown item id, and — unlike a barrel — for any item
that's itself a `container` (a backpack): NPCs never carry containers, and
(also unlike the player) are never weight-limited by what they carry, so
there's no cap to worry about on the `contents` list itself.

## How to add a stackable/commodity item type

Some items (coins, arrows, sling rocks — anything you pick up "a pile of" at
a time) shouldn't take a new inventory slot per pickup. Mark the
`ItemAssetDef` `stackable: true` (`src/assets/items/coin.ts`):

```ts
const coin: ItemAssetDef = {
  id: "coin",
  name: "Coins",
  icon: "🪙",
  slot: null,
  mass: 0.01, // per-unit -- a pile's total weight scales with its count
  stackable: true,
  createWorldMesh: () => createCoinPileMesh(),
};
```

`mass` stays per-unit; stacking is purely an inventory-slot convenience,
never a weight loophole — a pile of 20 coins weighs 20x one coin, checked
against the carrier's weight cap exactly like any other item (see
`itemCount`/`stackWeightOf` in `ecs/systems/items.ts`).

A world `ItemSpawn` for a stackable item can say how many units that
particular pile is worth via `count` (defaulting to 1 if omitted):

```ts
items: [{ id: "coin", x: 3.3, z: 6.3, count: 6 }],
```

Picking one up merges it into whatever stack of the same `itemTypeId` the
picker already holds, if any (`giveItem` in `ecs/systems/items.ts`) — no new
slot, just a bigger count on the existing one. The same merge-or-create
logic applies to `contents` entries (see above) and to moving a stack
between the player and an open container. Moving *part* of a stack (rather
than the whole pile) is a UI-level choice: tapping a stack of more than 1 in
the container panel opens a quantity picker (`containerStore.pendingTransfer`,
`ContainerPanel.tsx`) instead of moving it immediately; a stack of exactly 1,
or a non-stackable item, still moves on the first tap as before. This works
identically for a barrel and for a backpack — the container panel doesn't
distinguish between them, so there was no extra cost to supporting a
partial transfer into either one.

## Worked example: the first branch off the original line

This is what shipped alongside this doc (see `src/level/rooms/corridor.ts`
and `src/level/tileTypes/hallway_junction.ts`),
included here as a concrete instance of the walkthrough above, and as the
answer to the "current limitation" section: **how do you branch off an
already-placed straight run when neither existing type supports it and
there's no per-instance face override?**

The corridor (`corridor`, type `hallway`) was the lowest-risk place to
retrofit: unlike `room-a`/`room-b`, no hardcoded coordinate-anchored content
(the player spawn/NPC/items and furniture placed via `src/level/rooms/*.ts`)
lives inside it, so giving it an extra opening can't disturb anything else.
A new type, `hallway_junction` (`src/level/tileTypes/hallway_junction.ts`),
copies `hallway`'s exact footprint and north/south openings and adds one
more: a `"opening"` on the middle segment of its east face. The `corridor`
instance's `tileTypeId` was then changed from `"hallway"` to
`"hallway_junction"` — its `id`, `originCell`, `rotation`, and `sectorId`
are all untouched, so nothing coordinate-anchored moved and both original
doors (`room-a`'s and `room-b`'s) keep working exactly as before; the only
observable change is one new gap in a previously fully-solid side wall.
**This is the general technique for branching off an existing straight
run**: define a new type that's a strict superset of the old one's openings
(same connections, plus the new one), then swap the instance's
`tileTypeId` to it — never touch `originCell`/`rotation` on an instance
something else depends on positionally.

From that new opening, a `hallway` instance rotated 90° runs the branch
east (reusing the existing type — a rotated hallway is still a hallway),
ending in a new room type, `side_chamber` (`w=2, d=2, h=1` — deliberately
smaller and lower-ceilinged than `great_hall`'s `3×3×2`, so it reads as a
distinct kind of space rather than a smaller copy of the great hall), with
a single door on its west face meeting the branch corridor. Both new tile
instances live together in `src/level/rooms/side-chamber.ts` (see that
file's header comment for why one room file can place more than one
physical room). The player now gets a real choice at the junction:
continue straight to `room-b`, or turn off into the side chamber.
`side_chamber` is room-sized (`w,d > 1`) so it picks up torches
automatically; it also gets one bespoke decorative touch (that same
`side-chamber.ts` file's `props`) for the "distinct feel" pillar.

## Worked example: a vertical connection (issue #86)

The level's first floor change, built alongside this doc's update — a
second retrofit of the exact same corridor instance the side-chamber branch
used, plus a genuinely new concept (a floor) this system had never
exercised before. See `src/level/rooms/stairwell.ts` for the full authored
layout; this section walks through the *decisions*, not just the result.

**Retrofitting the junction into a crossroads.** `corridor.ts`'s one
instance had already been retrofitted once (`hallway` -> `hallway_junction`,
the worked example above). Adding a second branch, directly opposite the
first, is the exact same technique applied again: `hallway_junction`'s face
map (one opening on the middle segment of its east face) needed a matching
opening on the middle segment of its **west** face too. Since
`hallway_junction` had exactly one instance and nothing else could
plausibly want the narrower three-opening shape once this instance needs a
fourth opening, this retrofit evolved the type in place rather than leaving
an now-permanently-unused type file around: renamed to `hallway_cross`
(`src/level/tileTypes/hallway_cross.ts`), the old `hallway_junction.ts`
file deleted, `corridor.ts`'s instance's `tileTypeId` updated to match — its
`id`/`originCell`/`rotation`/`sectorId` never moved. Either approach (evolve
in place vs. add a new type and swap the id) is valid per the original
worked example's own guidance; this is the other reasonable reading of "you
decide" for a type with a single, otherwise-orphaned instance.

**Placing the new wing away from everything else.** The task that drove
this work specified "opposite the side room with the barrel" for a reason
worth restating: cell `(-1,-2)` — directly west of the junction, mirroring
the existing east branch — was unclaimed, and building the whole new wing
(corridor, stairs, landing, four rooms) further west from there runs into
open space rather than needing to route around `room-b` or anything else
already on the map. **Work out your own new wing's placement the same
way**: check the occupancy index (or just this doc's running tally of
claimed cells) before picking coordinates, and prefer growing into open
space over threading a new feature between existing ones.

**Why a real architecture change, not a per-instance hack.** Before this,
`sectorAt`/the occupancy index/`buildGeometryFromOccupancy` had no notion of
height at all — every tile's floor was implicitly `y ≈ 0`, and the cell key
was pure `(x, z)`. A staircase's two landings need to occupy the *same*
`(x, z)` on two different floors (see below), which an XZ-only key would
reject as an overlap. So this added, once, generically:

- `TileInstance.floor` (occupancy.ts) — which floor an instance is on;
  defaults to `0` so every existing room needed zero changes.
- `floorBaseline(floor)`/`floorForY(y)`/`FLOOR_RISE` (tiles.ts) — the one
  place "how far apart are floors" and "which floor is this Y" are defined.
- The occupancy index's key became `worldCellKey(x, z, floor)`
  (occupancy.ts) instead of `(x, z)` alone — this is *the* change that makes
  two floors sharing an XZ column not an overlap error.
- `sectorAt` (occupancy.ts) takes a world Y now and resolves the query's
  floor from it via `floorForY`, rather than only ever looking at XZ.
- `TileType.skipFloorSlab`/`skipCeilingSlab` (tiles.ts) — a type can opt out
  of the automatic floor or ceiling slab `buildGeometryFromOccupancy`
  otherwise builds per instance, for the one situation that needs it: a
  vertical shaft passing through where a slab would otherwise seal it.
- `PropPlacement`/`ItemSpawn`/`NpcSpawn.floor` (placementTypes.ts) — a
  placement's `y` is relative to its own floor's baseline, so every existing
  room's props/items (all implicitly floor 0) keep spawning exactly where
  they always did.

**The staircase itself: two paired tile instances, not one spanning tile.**
`stair_lower` (`src/level/tileTypes/stair_lower.ts`, floor 0) and
`stair_upper` (floor 1) share the *same* `originCell` — a 3-cell-long, 1-wide
shaft — linked by one `StairConnector` entry (`placementTypes.ts`) in
`stairwell.ts`'s `stairs` array, which is what actually builds the climbable
geometry between them (`src/level/stairBuilder.ts`). `stair_lower` sets
`skipCeilingSlab` (the shaft continues up through where its ceiling would
sit); `stair_upper` sets `skipFloorSlab` (its floor is the ramp geometry,
not a poured slab). A single tile spanning both floors couldn't express
this at all — occupancy cells belong to exactly one floor, and a "this
instance's floor slab is optional" flag has to apply per-floor-terminus, not
per-staircase.

**The collision is a smooth ramp; the visual is real stair steps — and this
was not the first design.** The original approach here was real stepped
risers sized to the character controller's autostep (`AUTOSTEP_MAX_HEIGHT`,
`physics/world.ts`) — exactly what that constant's own doc comment
describes as its purpose. It rendered correctly, the occupancy/face-map data
validated clean, and it still completely failed an actual Playwright
walk-up: the character stopped dead at the first riser and never climbed at
all. Isolating the cause with a throwaway static test box unrelated to any
tile in this level showed autostep does not engage *at all* in this
project's current Rapier build, for any step height tried — a real,
previously-unverified characteristic of this environment, not a bug in the
staircase's own geometry. The fix was switching to the controller's other
climbing feature, `setMaxSlopeClimbAngle`, which an isolated ramp test
confirmed does work: `stairBuilder.ts` builds one static box tilted so its
top face passes exactly through the shaft's entry and exit points (`~33.7°`
for this staircase's `FLOOR_RISE`/`STAIR_RUN_CELLS`, comfortably under the
controller's 50° max), and *separately* builds a purely cosmetic set of
non-overlapping stepped boxes (mesh only, no collider) whose outer corners
sit exactly on that same slope line — mismatched "simpler collision than
visual" geometry, a standard technique for exactly this situation. **The
practical lesson for the next person touching movement-adjacent physics
here: verify a real walk-up before trusting a constant's doc comment about
what it enables** — `AUTOSTEP_MAX_HEIGHT`'s comment calling out stairs as
its use case was written before anyone had actually tried building stairs
with it.

**A second bug this staircase shipped with, found the same way: you could
fall out of the level by stepping sideways off the ramp.** `stair_lower`/
`stair_upper` each get their own north/south walls from the generic
tile-builder pass, but only `STAIR_LANDING_HEIGHT_CELLS` (one grid cell, 3m)
tall above their own floor baseline. `FLOOR_RISE` is two cells (6m), so the
*middle* cell of the climb had no wall on either long side at all — real
space directly beside the ramp, with nothing else in the level's
surrounding empty world to catch a fall there. This wasn't caught by the
verification that shipped with the staircase (which walked the ramp's
centerline, never its edges) — it took someone actually trying to step off
the side to find it, the same lesson as the autostep story above one more
time: the geometry validating and rendering correctly says nothing about
whether the space around it is actually contained.

The fix (`stairBuilder.ts`'s `buildShaftGuardWalls`) is **not** to give the
landings a taller `h`: `stair_lower`'s west wall is deliberately only
`STAIR_LANDING_HEIGHT_CELLS` tall so the climb can pass over its top on the
way to `stair_upper`'s opening one floor up (see `stair_lower.ts`'s own doc
comment) — a uniform taller wall would also raise *that* wall and seal the
shaft's only exit shut at exactly the height the climb needs to pass
through it. Instead, `buildShaftGuardWalls` adds its own purpose-built
static walls that only ever flank the run's two long sides, spanning the
*entire* `FLOOR_RISE` (deliberately overlapping the shorter walls the
landings already build, rather than trying to start exactly where those
leave off, so this stays correct even if a landing's own height changes).
`STAIR_LANDING_HEIGHT_CELLS` (`tiles.ts`) exists specifically so this number
has one home, shared by `stair_lower.ts`/`stair_upper.ts`'s own `h` and this
gap calculation, rather than three places that could silently drift apart.

**A third bug, found after the second one shipped: one more gap at the
entry end, above the doorway.** `buildShaftGuardWalls` closes the shaft's
two *long* sides, but the shaft's *short* ends are a different situation —
each is a real opening (`stair_lower`'s east face, `stair_upper`'s west
face) that has to stay open at doorway height for the climb to pass
through, so nothing analogous to the long-side fix could just wall them
off outright. `stair_upper`'s far (east) end has no hallway beyond it, so
its own `h`-tall wall being short of `FLOOR_RISE` never mattered there —
there's nothing to fall into. But the *entry* end (`stair_lower`'s east
face, where `west-corridor` meets the shaft) does have a hallway beyond
it, and that hallway's own ceiling only reaches its own `h`
(`STAIR_LANDING_HEIGHT_CELLS`) above *its* floor — the same height as
`stair_lower`'s own walls. That left the band from y=3 to y=6, directly
above the entry doorway, with no wall at all on that boundary: real space
open to the corridor's own ceiling void one floor up, on the one shaft end
that actually borders another occupied room.

The fix (`stairBuilder.ts`'s `buildEntryHeader`) is the same pattern
`tileBuilder.ts`'s `addDoorPair` already uses for sealing space above a
door opening while leaving the opening itself clear: one static wall
segment spanning only the y=3-to-6 band at the entry's x boundary, full
cell width, flush with `WALL_THICKNESS`. It only needs to exist at the
entry end — the exit always lands exactly on the upper floor's own
baseline by construction (`rampGeometryOf`), so there's no equivalent gap
to seal there. Confirmed via Playwright (teleporting into the gap band
itself, since it turns out not to be reachable by simply walking off the
ramp — the climb's own slope ties X and Y together, so walking "back
toward the hallway" from mid-climb just follows the ramp back down to floor
level) that the band is now blocked, that normal doorway passage at
y=0-3 is unaffected, and that the full climb still lands cleanly on floor
1.

**Sector id for the pair.** `stair-lower`/`stair-upper` share one sector id
(`"stairwell"`) rather than getting their own — deliberate, since
`floorForY`'s Y-to-floor rounding means a position genuinely mid-climb could
resolve to either landing's floor depending on exactly where the 50/50
rounding line falls; giving both the same sector makes that not matter for
sector tracking (corpse cleanup, the `[sector]` console log) either way.

**The upper floor's four rooms.** `upper_landing` (`src/level/tileTypes/
upper_landing.ts`, a 2x2 room-sized hub, so it gets automatic torches) sits
at the top of the stairs with five openings — one back down the stairs, four
out to small 1x1 `nook` rooms (`src/level/tileTypes/nook.ts`), one per
compass direction, reused via rotation exactly like `great_hall` is for
`room-a`/`room-b`. Only the hub got a bespoke decorative touch (one
candelabra); the four nooks stay bare, per the task's own "proving the
traversal works is the point, not filling every room" framing — bare is a
valid, deliberate choice here, not an oversight.

**What this doesn't fix.** `npcSystem`'s aggro/leash checks (`ecs/systems/
npc.ts`) are still pure XZ distance, blind to Y/floor — an aggressive NPC
placed directly above (or below) another one's aggro radius could sense
through the floor. Not exercised by this wing (no aggressive NPC placed
here), and not fixed in general — flagged on `NpcSpawn.floor`'s doc comment
for the next person placing a hostile near an existing one on a different
floor. The level viewer's sector overlay also only tints floor-0 cells now
(see `levelViewer.ts`'s `addSectorOverlays`) rather than fully supporting
per-floor display — a deliberate, documented "cheap version," not a full
fix. (The bandit mentioned above as "far away" from this wing has since
moved to the cellar, floor -1 — see the next section — which is if
anything further away still.)

## Worked example: a *downward* vertical connection, and the floor-clamp fix it needed (cellar wing)

The level's second vertical connection (training-wing/cellar/dormitory
task) — floor 0 down to a new floor -1 (the cellar), branching off
`room-b` this time instead of the main corridor. Mechanically this is the
*exact same* `StairConnector` + paired `stair_lower`/`stair_upper` tile
system the upstairs wing uses (see the worked example above) — nothing
about that system is inherently "upward only" — but building the first
real negative floor surfaced one genuine bug and one branching decision
worth recording.

**The bug: `floorForY` (`tiles.ts`) used to hard-clamp to floor 0.** Before
this task, `floorForY(y)` was `Math.max(0, Math.round(y / FLOOR_RISE))`.
Its own doc comment framed the clamp as jitter protection (so a falling
ragdoll a few centimeters under a floor slab doesn't misreport as a
negative floor) — but rounding-to-nearest already provides exactly that
protection on its own, for any floor, since a `y` within `FLOOR_RISE / 2`
of a baseline rounds straight back to it regardless of any clamp. What the
old clamp actually did was unconditionally forbid *any* negative floor —
correct back when floor -1 didn't exist (nothing else a deeply-negative `y`
could legitimately mean), wrong the moment a real floor -1 (the cellar) did.
The fix re-points the same clamp at `MIN_FLOOR` (`tiles.ts`, currently -1 —
the lowest floor actually built) instead of a hardcoded 0, so a genuine
floor -1 position resolves correctly while a wild physics glitch still
can't report a floor that doesn't exist. See `floorForY`'s doc comment for
the full reasoning — update `MIN_FLOOR` the day a floor deeper than -1
exists.

**Branching off `room-b` instead of the main corridor.** The corridor
(`hallway_cross`) already has all four of its openings spoken for (north/
south/east/west — room-a, room-b, side-chamber, stairwell), so it couldn't
take a fifth. `room-b` had a spare option the corridor didn't: `great_hall`
(its tile type) has three solid, unused faces (north/east/west), and unlike
the corridor's single, already-fully-used instance, giving *one* of
`great_hall`'s two instances (`room-a`, `room-b`) a new opening needs a new
type rather than an in-place edit — editing `great_hall.ts` itself would
silently add the same opening to `room-a` too, which has nothing behind it
and would fail `validateOccupancy`. `great_hall_branch.ts` is that new
type: `great_hall` plus one opening on local west's middle segment, and
only `room-b`'s instance swapped onto it (`room-a` keeps plain `great_hall`,
untouched) — the same "new type, swap one instance's `tileTypeId`" pattern
`docs/LEVEL_DESIGN.md`'s "current limitation" section describes as option
(a), used here instead of the `hallway`/`hallway_junction` case's option
(b) because `great_hall` has two instances where `hallway_cross` had one.

**The downward shaft reuses `stair_lower`/`stair_upper` unmodified.** A
tile type's name describes which *end of a shaft* it is (skips its own
floor or ceiling slab so the shaft has somewhere to go), not which literal
floor numbers it connects — so the same `stair_upper` (skips floor slab,
opens west) works as the shaft's top terminus at `floor: 0`, and the same
`stair_lower` (skips ceiling slab, opens east) works as its bottom terminus
at `floor: -1`, with a `StairConnector` naming `floorBelow: -1, floorAbove:
0`. No new tile types were needed for the shaft itself, only for the two
rooms it connects (`great_hall_branch` above, `cellar_room` for the
cellar's own room — kept a separate type from `side_chamber` rather than
reused, specifically so a later change to `side_chamber`'s own face map
can never silently leak a second opening into the cellar).

**The warning, and why it's narrative-only.** A poster in `room-b`, next to
the new opening, tells the player not to go down — the same "foreshadow
before you get there" device `side-chamber.ts`'s journal scroll uses for
this same bandit encounter. There's no gate: the stairs are plain
`"opening"`s, not a locked door, so a curious player can just walk down —
that's the point (the warning is supposed to *not* stop you).

**The bandit moved down here.** `room-b`'s bandit (issue #70's first
aggressive archetype) relocated to the cellar with it, unchanged — same
archetype, same seeded loot (a gem) — making the cellar the level's actual
final encounter instead of the first room behind a locked door. `room-b`
itself is left quiet (its shrine/barrels stay, the locked door + key
pairing stays meaningful as a gate on the room and the stairs beyond it,
but there's no spawn there anymore) — the "not every room needs a spawn"
pacing pillar applies same as ever.

**A trap this uncovered for testing an NPC behind a real door:** the
cellar's bandit sits behind an ordinary (unlocked) hinged door, and an
NPC's own `CHASING` movement never opens a door itself — only the player's
interact does (`tryInteract`, `ecs/systems/doors.ts`). A Playwright spec
that teleports the player just outside the bandit's aggro range and then
stops walking the instant aggro fires (the pattern the original room-b
tests used) leaves the bandit stuck at the far side of a door it can't
open, `CHASING` forever without ever reaching `ATTACKING`. The fix (see
`bandit-combat.spec.mjs`/`corpse-linger.spec.mjs`) is to keep walking (and
pressing the interact key periodically) all the way up to the bandit's
*live* position after aggro fires, exactly what a real player would do,
rather than assuming proximity alone finishes the encounter.

## Worked example: the training wing (branching off an already-branched room)

The training wing (training wing task) adds four small rooms — melee,
ranged (dressed for a mechanic that doesn't exist yet), equipment, and a
locked "lockpicking" alcove — fanning out from one hub, branching east off
`side-chamber.ts`'s room. See `rooms/training-wing.ts` for the full
authored layout and cell-by-cell reasoning; this section covers the
decisions worth remembering.

**Why `side-chamber`, not `room-b`, as the branch point.** Both the cellar
wing (see above) and this wing needed a new branch off the existing map at
the same time. `room-b`'s type (`great_hall`) is shared with `room-a`, so
giving it a second opening needed a whole new type (`great_hall_branch`).
`side_chamber` (the original side-chamber room's type) has exactly *one*
instance, so it could just be edited in place — the lower-friction option,
and it happened to have an already-clear corner (its north-east, past all
of its existing crate/lantern/backpack/scroll clutter) to put the new
opening on. When two unrelated features both need a new branch, picking
whichever existing type has the fewest instances to disturb is worth
checking before reaching for a brand-new type.

**A hub with five spokes, sized for the job.** `training_hub` is a fresh
3x3 type (matching `great_hall`'s footprint), not a reuse of the upstairs
wing's 2x2 `upper_landing` — a 2x2 hub was tried first and didn't have
enough room: two of its four spoke rooms (each 2x2 themselves) ended up
needing overlapping footprints once actually laid out in cell coordinates
(caught by `validateOccupancy`'s overlap error, not by eyeballing the
plan). Sizing the hub up to 3x3 gave every spoke a full cell of separation
from its neighbors along the hub's own walls, which is the real fix — not
anything specific to this wing, just "a hub needs to be big enough for as
many 2x2+ rooms as you're hanging off it without their footprints
colliding," worth checking arithmetically (or just building it and letting
`validateOccupancy` catch it) rather than assuming a hub type scales down
freely.

**`small_room`, not a second use of the (already-modified) `side_chamber`
type.** The training wing's melee/ranged/equipment rooms are the exact
same shape `side_chamber` used to be (a plain single-door 2x2) — but
`side_chamber` itself now has a *second* opening (the one this wing
branches off of). Placing another instance of `side_chamber` for, say, the
melee room would have silently given the melee room that same second
opening too, with nothing on the other side of it — caught immediately by
`validateOccupancy` (a real mistake made and reverted while building this
wing, not a hypothetical). `small_room.ts` is a new type that's simply what
`side_chamber` looked like before its second opening was added, reused via
rotation for all three spoke rooms exactly the way `great_hall`/
`side_chamber` are elsewhere. The general lesson: once a previously
single-purpose type picks up a second opening for one specific feature
(exactly the "worked example: the first branch" pattern earlier in this
doc), *every other* place reusing that type inherits the new opening too —
worth checking before reusing a type that's just been extended, not only
when defining a brand-new one.

**Owner-direction locked doors:** see the "how to lock a door" section
above — the lockpicking nook's door needed addressing from its neighbor's
cell/side, not its own, and that's now documented there rather than
repeated here.

**Deliberately out of scope, dressed but not functional:** the ranged
training room has no real ranged-combat mechanic (none exists in this
codebase yet) — it's crates standing in for target bales and a poster
that says so outright, rather than a half-built mechanic. The equipment
room has no buy/sell/trade system (also not implemented anywhere) — its
quartermaster NPC (a second docile archetype, `quartermaster.ts`, same
template as `villager.ts`) says plainly that trading isn't set up, and its
display gear is just free-standing world items like any other pickup. The
lockpicking nook nods at lockpicking via the existing `Door.locked`/key
mechanic (a new `rusty_key` item, kept distinct from `key.ts`'s own "key"
id so the two unrelated locked doors don't share one solution) rather than
a real minigame — find the key, open the door, same as any other locked
door in the level.

## Sector-scoped render culling (perf investigation)

As the level grew to ~9 rooms across 3 floors, two things turned out to cost
real frame time regardless of where the player actually was: every torch's
shadow-casting light stayed on everywhere, all the time (a full extra
shadow-map render pass each, per frame), and every wall/floor/ceiling/prop/
item ever built stayed in the scene graph forever, fully rendered, no matter
how far from the player it sat. `src/level/visibility.ts` fixes both by
gating `light.castShadow` and `mesh.visible` off for any sector that isn't
the player's current one or one open (door/opening) connection away — see
that file's own header comment for the full mechanics and the "why one hop,
not current-only" reasoning.

**Nothing new to author.** This runs entirely off the `sectorId` every tile
instance already needs (see "Use sectorId meaningfully" in the design
pillars above) and the occupancy index's own open/wall face data — a new
room built the normal way (a `RoomContent` with real `sectorId`s and real
door/opening faces connecting it to whatever's next to it) is automatically
covered: its walls/floor/ceiling/torches/doors register themselves during
`tileBuilder.ts`'s/`stairBuilder.ts`'s normal build pass, and its
props/items/readables register themselves during `spawning.ts`'s normal
spawn pass, each tagged by resolving its own `(x, z, floor)` against the
occupancy index (`sectorAtCell`, `occupancy.ts`) — no `sectorId` field was
added to `PropPlacement`/`ItemSpawn`/`ReadablePlacement` for this; the
existing `x`/`z`/`floor` already say everything needed.

**One real consequence for level shape: a sector with no open connection to
anything only ever renders while the player is standing directly inside
it.** This was already effectively true for *reachability* (an isolated
sector isn't part of the level graph at all, `validateOccupancy` would
reject an opening facing empty space) — but it's newly true for *visibility*
too: there's no way, with this system, to build a room meant to be seen from
a distance through a window or across a courtyard without an actual open
connection linking it into the sector graph. Nothing in the current level
wants that effect; worth knowing before designing a feature that does.

**Two categories of registered object are deliberately *not* culled, for
correctness rather than performance reasons — see their own doc comments for
the full reasoning (`spawning.ts`'s `spawnNpcs`/`spawnProps`):**

- **NPCs are never registered at all.** A docile NPC can be told to follow
  the player (`toggleNpcFollow`) and will then cross sector boundaries as a
  normal, expected part of play — tagging its mesh to its spawn sector would
  make it visibly vanish mid-follow. There are only a handful of NPCs in the
  level, so never culling them costs nothing worth trading for that risk.
- **A dynamic (physics-shoveable) prop or item is registered at its
  build-time position's sector and never re-tagged if shoved elsewhere by
  physics** (a barrel pushed through an open doorway into the next room,
  say) — unlike a *picked-up-and-dropped* item, which `dropCarriedItem`
  correctly re-tags to wherever it actually lands, since a player interact
  action is the one point in the whole system that already knows both the
  item and its new position at once. A shoved prop crossing an entire sector
  boundary hasn't been observed in practice (this game's dynamic props settle
  near where they're authored), but if a future mechanic starts routinely
  flinging heavy props around, this is the corner that would need real
  per-frame position tracking to close properly.

**Debugging a sector that looks wrong:** `window.__vibeDungeonDebug`'s
`getVisibilityDebugCounts()` (visible-vs-total objects, active-vs-total
shadow lights) and `getRendererInfo()` (`renderer.info`'s draw-call/triangle
counts) are the two hooks written for exactly this — see
`tests/integration/sector-visibility.spec.mjs` and
`geometry-culling.spec.mjs` for the pattern (teleport, poll `getCurrentSector`
until it settles, then read the debug counts) if a new room needs the same
kind of verification.

**A plain `"opening"` joining two different-height (`h`) tile types needs
its own header seal, same as a `"door"` does.** Found by this exact perf
investigation, not by design: `room-b` (`great_hall_branch`, `h: 2`) opens
directly into `stair_upper` (`h: 1`) via a plain opening (no door leaf
wanted there), and `tileBuilder.ts`'s wall/door emission pass used to treat
every `"opening"` as "just empty space, no geometry" unconditionally — fine
when both sides share one `h` (every `"opening"` in the level did, until
this one), but a real hole straight through to the scene's background color
when they don't, since nothing else seals the gap between the shorter
side's own ceiling height and the taller side's. Fixed generically (any
future `"opening"` between mismatched `h` values gets the same header a
`"door"` there would) rather than special-cased to this one instance — see
the fix's own comment where `effective === "opening"` is handled in
`buildGeometryFromOccupancy`. Worth checking for on any future opening
between a full-height room and a low-ceilinged connector type (a hallway,
a stairwell landing, a nook).

**Real-time shadow-casting torches were disabled globally** (`renderer.
shadowMap.enabled = false`, `game.ts`) as part of this same perf pass — in
actual play they were never really visible (small light sources close to
the flat walls they're mounted on), so a full extra render pass per active
light was pure cost with no payoff. Every torch still declares its own
shadow settings and still participates in the sector-based gating above;
both are simply inert while this flag is `false`, so flipping it back to
`true` alone restores shadows if a future lighting pass finds a way to make
them actually read on screen.
