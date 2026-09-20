import type { RoomContent } from "../placementTypes";

// The training wing (training wing task): a short sequence of new rooms
// branching off `side-chamber.ts`'s room, east into open space (nothing
// else occupies x>18 anywhere in the level yet) — a melee training room, a
// ranged training room with recoverable crossbow bolts, an
// equipment display room, and a small locked "lockpicking" alcove, all
// fanning out from one central hub.
//
// `side-chamber` was picked over `room-b` as the branch point specifically
// because `side_chamber` (its tile type) has exactly one instance, so
// giving it a second opening could be done as an in-place edit (see that
// type's own doc comment) rather than needing a whole new type the way
// `room-b`'s `great_hall` (shared with `room-a`) did for the cellar wing —
// the lower-friction option, and `side-chamber`'s own north-east corner
// (world x=18, z in [-3,0]) was already clear of its existing crate/
// lantern/backpack/scroll clutter (all south of z=-1.3).
//
// ## World layout (cell coordinates; multiply by UNIT=3 for world meters)
//
// - `training-corridor` (`hallway`, rotation 90): cells (6,-1), (7,-1),
//   (8,-1). Opens west into `side-chamber`'s new east door at (5,-1), and
//   east into the hub's west opening at (9,-1).
// - `training-hub` (`training_hub`, floor 0): originCell {x:9, z:-2}, a 9m x
//   9m room (3x3 cells, matching `great_hall`'s size — see that type's own
//   doc comment for exactly which of its 12 perimeter segments are open).
//   One opens back to the corridor (west); the other four fan out to this
//   wing's four rooms.
// - `melee-room` (`small_room`, rotation 90): originCell {x:9, z:1}, its
//   one door landing at world cell (9,1)'s negZ face — the hub's north
//   opening (boundary z=0/1 at x=9). Cells (9,1),(9,2),(10,1),(10,2); world
//   x in [27,33], z in [3,9].
// - `ranged-room` (`small_room`, rotation 270): originCell {x:10, z:-4},
//   door at world cell (10,-3)'s posZ face — the hub's south opening
//   (boundary z=-3/-2 at x=10). Cells (10,-4),(10,-3),(11,-4),(11,-3);
//   world x in [30,36], z in [-12,-6].
// - `equipment-room` (`small_room`, rotation 0 — the type's own
//   unrotated door, no rotation math needed): originCell {x:12, z:-2}, door
//   at world cell (12,-2)'s negX face — the hub's east opening nearer -z
//   (boundary x=11/12 at z=-2). Cells (12,-2),(12,-1),(13,-2),(13,-1);
//   world x in [36,42], z in [-6,0].
// - `lockpick-nook` (`lock_nook`, rotation 270 — same rotation table
//   `nook.ts` documents, 270 opens west since the underlying rotation math
//   is identical, only the `"door"` `FaceKind` differs): originCell
//   {x:12, z:0}, a single cell whose negX face meets the hub's east opening
//   nearer +z (boundary x=11/12 at z=0). World x in [36,39], z in [0,3].
//
// All four rooms and the hub are placed with at least a full solid cell of
// separation from each other and from `training-corridor`/`side-chamber` —
// see the cell list above; nothing here shares a cell with anything else.
//
// `melee-room`/`ranged-room`/`equipment-room` are all room-sized (2x2) so
// they pick up automatic torches like `side-chamber`'s own room does;
// `training-hub` (3x3) does too. `lockpick-nook` (1x1) doesn't, same as the
// upstairs wing's `nook`s — it's meant to be a small, dim alcove, not
// another proper room.

const trainingWing: RoomContent = {
  tiles: [
    {
      id: "training-corridor",
      tileTypeId: "hallway",
      originCell: { x: 6, z: -1 },
      rotation: 90,
      sectorId: "training-corridor",
    },
    {
      id: "training-hub",
      tileTypeId: "training_hub",
      originCell: { x: 9, z: -2 },
      rotation: 0,
      sectorId: "training-hub",
    },
    {
      id: "melee-room",
      tileTypeId: "small_room",
      originCell: { x: 9, z: 1 },
      rotation: 90,
      sectorId: "melee-room",
    },
    {
      id: "ranged-room",
      tileTypeId: "small_room",
      originCell: { x: 10, z: -4 },
      rotation: 270,
      sectorId: "ranged-room",
    },
    {
      id: "equipment-room",
      tileTypeId: "small_room",
      originCell: { x: 12, z: -2 },
      rotation: 0,
      sectorId: "equipment-room",
    },
    {
      id: "lockpick-nook",
      tileTypeId: "lock_nook",
      originCell: { x: 12, z: 0 },
      rotation: 270,
      sectorId: "lockpick-nook",
    },
  ],
  // The lockpick-nook's one door -- authored on `lock_nook`'s own cell
  // (12,0)'s negX face (see `lock_nook.ts`), but `tileBuilder.ts`'s wall/
  // door emission only ever looks up a shared boundary's lock data from the
  // "owner" direction (posX/posZ -- see `WALL_DIRS` in tileBuilder.ts), and
  // negX isn't one of those. This boundary's owner is actually the *hub*'s
  // side of it: cell (11,0)'s posX face. Addressing it from `lock_nook`'s
  // own (non-owner) side would silently match nothing and build an ordinary
  // unlocked door instead (confirmed the hard way -- see
  // docs/LEVEL_DESIGN.md's "how to lock a door" section's own warning about
  // this failure mode). Its key sits out in the open in the hub (below), a
  // short, fully self-contained detour rather than sending the player back
  // across the level for it.
  lockedDoors: [{ x: 11, z: 0, side: "posX", requiredItemTypeId: "rusty_key" }],
  props: [
    // --- Hub decor: a second crossed-swords trophy (echoing room-a's) on
    // the hub's solid west-wall segment south of the entry door, and target
    // dummies/crates/tables in each room below. ---
    { id: "crossed-swords", x: 27.3, z: -4.5, rotation: Math.PI / 2 },

    // --- Melee training room (world x[27,33], z[3,9]): two target
    // dummies, well clear (z >= 7) of the door's swing arc (near the room's
    // south wall, z~3). ---
    { id: "target-dummy", x: 29.0, z: 8.0 },
    { id: "target-dummy", x: 31.0, z: 7.0 },

    // --- Ranged training room: wooden crates make useful bolt-sticking
    // targets, clear of
    // the door (north wall, z~-9) by keeping these toward the south wall. ---
    { id: "crate", x: 32.0, z: -10.5, rotation: 0.1 },
    { id: "crate", x: 34.0, z: -11.0, rotation: -0.2 },

    // --- Equipment room: a display table with a couple of swords (items,
    // below) resting on it. ---
    { id: "table", x: 40.0, z: -1.5 },
  ],
  npcs: [
    { id: "weapons-master", x: 30.0, z: 5.7 },
    { id: "guard", x: 29.0, z: 1.5 },
    // Equipment room's quartermaster, wandering near the table, clear of
    // the door's swing arc (west wall, x~36-37).
    { id: "quartermaster", x: 38.0, z: -3.0 },
  ],
  items: [
    { id: "wooden_sword", x: 32.0, z: 4.5, y: .7 },
    { id: "crossbow", x: 33.0, z: -9.8, y: .75 },
    { id: "bolt", x: 33.45, z: -9.8, y: .75, count: 12 },
    // Rusty key for the lockpick-nook's door, left out in the open in the
    // hub -- see `lockedDoors` above.
    { id: "rusty_key", x: 31.5, z: -1.0 },

    // Equipment room's display pieces -- both drop onto the table
    // (ITEM_HEIGHT's default 1m fall) rather than the floor, landing within
    // its ~1.2m x 0.8m top.
    { id: "sword", x: 39.8, z: -1.6 },
    { id: "sword", x: 40.2, z: -1.4 },

    // Lockpick-nook's reward: a backpack (itself a Container, an inventory
    // upgrade) for actually finding the key and using it -- see
    // docs/LEVEL_DESIGN.md's "how to add a container" section on a
    // furniture container's `contents` (a chest can hold an item that's
    // itself a container, same as a barrel can hold a backpack).
    { id: "backpack", x: 37.5, z: 1.5 },
  ],
  readables: [
    {
      id: "poster",
      x: 35.7,
      z: -1.5,
      rotation: -Math.PI / 2, // hub's east wall, facing west into the room
      title: "Training Wing",
      pages: ["Take what you need. Practice here, not out there."],
    },
    {
      id: "poster",
      x: 27.3, // west wall of melee-room
      z: 5.0,
      rotation: Math.PI / 2,
      title: "Melee Training",
      pages: ["Strike the practice dummies all you like. No enemy here strikes back."],
    },
    {
      id: "poster",
      x: 35.7,
      z: -8.0,
      rotation: -Math.PI / 2, // east wall of ranged-room
      title: "Ranged Training",
      pages: [
        "Take the crossbow and bolts. Fired bolts can be recovered; those that strike wood remain embedded until collected.",
      ],
    },
  ],
};

export default trainingWing;
