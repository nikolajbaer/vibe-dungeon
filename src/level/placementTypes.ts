import type { TileInstance } from "./occupancy";

// Level-authoring data shapes — the other half of the asset-authoring
// system (see src/assets/types.ts's header comment for the full picture).
// A `PropPlacement`/`ItemSpawn` references an asset by `id` (matching a
// `FurnitureAssetDef.id`/`ItemAssetDef.id`) plus where/how to place it; the
// generic `spawnProps`/`spawnItems` (level/spawning.ts) do the actual
// ECS/mesh wiring uniformly, so authoring a room means writing plain data,
// never touching shared spawn logic. A `RoomContent.tiles` entry is the same
// idea one level up: it references a tile *type* by `tileTypeId` (matching a
// `TileType.id` under `src/level/tileTypes/`) plus where/how to place it in
// the grid — see `src/level/rooms.ts` for how every room's tiles are
// aggregated into the one `OccupancyIndex` the whole level is built from.

/** One prop placed in the level. Lives in a `RoomContent.props` array (see
 * below) — one file per room/area under `src/level/rooms/`, so two agents
 * decorating different rooms can never collide on the same lines the way
 * two PRs both editing a shared `addDecorations()` function body once did. */
export interface PropPlacement {
  /** References a `FurnitureAssetDef.id` (src/assets/furniture/*.ts). */
  id: string;
  x: number;
  z: number;
  /** Height off the floor, meters — default 0, *relative to `floor`'s own
   * baseline* (see below), not an absolute world Y. A collider is only
   * attached at this-floor-relative y=0 (see `spawnProps` in
   * `level/spawning.ts`): a decorative piece stacked above another (e.g. a
   * second crate on top of the first) doesn't get a redundant second
   * floor-plan collider at the same x/z. */
  y?: number;
  /** Radians around Y, applied to the built mesh generically — default 0.
   * Every furniture asset builds facing local +z; this is how a placement
   * points it at whichever wall/direction it actually needs. */
  rotation?: number;
  /** Which floor (see `TileInstance.floor`, `tiles.ts`'s `floorBaseline`)
   * this prop sits on — default 0 (the ground floor, and the only value
   * that existed before issue #86). `spawnProps` adds `floorBaseline(floor)`
   * to `y` once, so every existing placement (all implicitly floor 0) keeps
   * spawning at exactly the world Y it always did. */
  floor?: number;
  /** Asset-specific extra data (e.g. banner.ts's `BannerParams` colors) —
   * see the referenced asset's own module for its shape. */
  params?: unknown;
}

/** One item placed in the world as a pickup. Lives in a `RoomContent.items`
 * array. */
export interface ItemSpawn {
  /** References an `ItemAssetDef.id` (src/assets/items/*.ts). */
  id: string;
  x: number;
  z: number;
  /** Height off the floor, meters — default `ITEM_HEIGHT` (level/spawning.ts),
   * relative to `floor`'s own baseline (see `PropPlacement.floor`'s doc
   * comment — same convention). */
  y?: number;
  /** Which floor this item sits on — default 0. See `PropPlacement.floor`. */
  floor?: number;
}

/** One NPC placed in the world. Lives in a `RoomContent.npcs` array. */
export interface NpcSpawn {
  /** References an `NpcArchetypeDef.id` (src/assets/npcs/*.ts). */
  id: string;
  x: number;
  z: number;
  /** Which floor this NPC sits on — default 0. See `PropPlacement.floor`.
   * Worth a second look before placing an aggressive archetype upstairs:
   * `npcSystem`'s aggro check (`ecs/systems/npc.ts`) is pure XZ distance,
   * blind to Y/floor entirely (see README's "Tile-based level system" /
   * this file's own `RoomContent` doc comment for the wider caveat) — an
   * aggressive NPC placed directly above (or below) another one's aggro
   * radius could sense through the floor. Not fixed here; just don't make a
   * new placement collide with it. */
  floor?: number;
}

/** Where the player starts: position plus initial facing (radians, same
 * convention as `Rotation.yaw`). Exactly one room file should declare this
 * — `src/level/rooms.ts` throws at build time if zero or more than one do,
 * the same "fail loudly, don't silently pick one" philosophy as
 * `occupancy.ts`'s `validateOccupancy`. */
export interface LevelSpawn {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Describes one physical staircase connecting two adjacent floors (issue
 * #86) — the actual climbable riser geometry (real stepped Rapier boxes,
 * see `stairBuilder.ts`'s `buildStaircase`) that a `stair_lower.ts`/
 * `stair_upper.ts` tile *pair* needs in addition to their own wall/floor/
 * ceiling geometry (which `buildGeometryFromOccupancy` already builds
 * generically from the occupancy index, same as every other tile).
 *
 * This is plain placement data, following the exact same "a room's file
 * describes what it needs, a generic builder turns it into real geometry"
 * shape as `PropPlacement`/`ItemSpawn` — a new staircase is a new
 * `RoomContent.stairs` entry, never a change to `stairBuilder.ts` itself.
 *
 * `x`/`z` is the world *cell* (not meters) both landings share — see
 * `TileInstance.floor`'s doc comment on why a staircase's two tile
 * instances legitimately occupy the same `(x, z)` on different floors.
 * `axis`/`direction` describe, in world space, which way the stairs climb
 * as you ascend from `floorBelow` to `floorAbove`: `axis: "x"` climbs along
 * X (`direction: 1` = toward +X, `-1` = toward -X), `axis: "z"` likewise
 * along Z. This is authored directly in world space (unlike a tile type's
 * face map, which is authored in local space and rotated per instance)
 * because a staircase's *physical* climb direction has to be one single
 * consistent world direction shared by both of its tile instances — see
 * `stairBuilder.ts`'s header comment for why deriving it from each
 * instance's own (potentially different) `rotation` instead would be
 * fragile rather than simpler.
 */
export interface StairConnector {
  x: number;
  z: number;
  floorBelow: number;
  floorAbove: number;
  axis: "x" | "z";
  direction: 1 | -1;
}

/**
 * Marks one already-authored "door" face (a `TileType.faces` segment set to
 * `"door"` — see `tiles.ts`'s `FaceKind`) as locked, requiring an item in the
 * player's inventory to open (see `doors.ts`'s `toggleDoor`). This doesn't
 * place a door itself — the face map already does that — it just attaches
 * lock data to the specific door boundary tileBuilder.ts would otherwise
 * build as an ordinary unlocked one.
 *
 * `x`/`z` is the *world grid cell* whose face map declares this boundary
 * (not necessarily the tile instance's origin — a multi-cell instance's door
 * segment can sit on any one of its cells), and `side` is which of that
 * cell's four world-space faces it's on. This is the same cell+side that
 * `tileBuilder.ts`'s wall/door emission already iterates in (`WALL_DIRS`),
 * so identifying a locked door this way needs no new addressing scheme —
 * check the emitted door's own log output, or the level viewer, to find the
 * right cell/side rather than hand-deriving it from a tile type's *local*
 * face map through its instance's rotation, which is what the wall-emission
 * code exists to do for you.
 */
export interface LockedDoorSpec {
  x: number;
  z: number;
  side: "negX" | "posX" | "negZ" | "posZ";
  /** References an `ItemAssetDef.id` (a key) that unlocks it. */
  requiredItemTypeId: string;
}

/**
 * One narration fixture (a poster or scroll) placed in the level. Lives in
 * a `RoomContent.readables` array — same shape/placement-vs-registry split
 * as `PropPlacement`, except the actual content (`title`/`pages`) is
 * per-instance data here rather than something a shared asset type could
 * own (see `Readable`'s doc comment in `ecs/components.ts`).
 */
export interface ReadablePlacement {
  /** References a `FurnitureAssetDef.id` (src/assets/furniture/*.ts) for
   * what this fixture *looks like* — typically `"poster"` (wall-mounted) or
   * `"scroll"` (resting on a surface or the floor). Any furniture asset
   * works here in principle, but one with a `footprint`/`dynamic` collider
   * would be an unusual choice for something meant to just stand and be
   * read. */
  id: string;
  x: number;
  z: number;
  /** Height off the floor, meters — default 0. Same convention as
   * `PropPlacement.y`: relative to `floor`'s own baseline, not an absolute
   * world Y. */
  y?: number;
  /** Radians around Y — same convention as `PropPlacement.rotation`: every
   * furniture asset builds facing local +z, so this is what actually points
   * a wall-mounted poster at the wall it's on. */
  rotation?: number;
  /** Which floor this fixture sits on — default 0. See
   * `PropPlacement.floor`. */
  floor?: number;
  /** Asset-specific extra data, threaded through to the furniture asset's
   * `createMesh` exactly like `PropPlacement.params`. */
  params?: unknown;
  /** Shown as the reader panel's heading — omit for an anonymous notice
   * (e.g. a scrap of paper with no letterhead). */
  title?: string;
  /** The notice's text, one entry per page. A single entry is the common
   * case; more than one gets a next/prev-paged reader UI automatically —
   * see `notice/NoticePanel.tsx`. Must be non-empty. */
  pages: string[];
}

/** Everything one room/area places in the level — the default export of
 * each file under `src/level/rooms/`. `src/level/rooms.ts` auto-discovers
 * every such file (via `import.meta.glob`) and flattens all of their
 * `tiles`/`props`/`items` together (and collects the one `spawn`), so
 * adding a new room means adding one new file under `rooms/` and nothing
 * else — including the tile instances that carve the room/corridor itself
 * out of the grid, not just its decorations. A file doesn't need to place
 * exactly one physical room: `side-chamber.ts`, for instance, places both
 * the side-chamber room *and* the corridor branch leading to it, since
 * those were authored together as one feature (see that file's header
 * comment). */
export interface RoomContent {
  tiles?: TileInstance[];
  props?: PropPlacement[];
  items?: ItemSpawn[];
  npcs?: NpcSpawn[];
  spawn?: LevelSpawn;
  /** Physical staircase connectors this room/area needs built (issue #86) —
   * see `StairConnector`'s doc comment. Usually paired one-for-one with a
   * `stair_lower`/`stair_upper` tile instance pair in this same file's
   * `tiles` array. */
  stairs?: StairConnector[];
  /** Doors (already authored as `"door"` faces in this file's `tiles`) that
   * should be locked — see `LockedDoorSpec`'s doc comment. */
  lockedDoors?: LockedDoorSpec[];
  /** Posters/scrolls this room/area places — see `ReadablePlacement`'s doc
   * comment. */
  readables?: ReadablePlacement[];
}
