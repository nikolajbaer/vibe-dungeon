// Level-authoring data shapes — the other half of the asset-authoring
// system (see src/assets/types.ts's header comment for the full picture).
// A `PropPlacement`/`ItemSpawn` references an asset by `id` (matching a
// `FurnitureAssetDef.id`/`ItemAssetDef.id`) plus where/how to place it; the
// generic `spawnProps`/`spawnItems` (level/spawning.ts) do the actual
// ECS/mesh wiring uniformly, so authoring a room means writing plain data,
// never touching shared spawn logic.

/** One prop placed in the level. Lives in a `RoomContent.props` array (see
 * below) — one file per room/area under `src/level/rooms/`, so two agents
 * decorating different rooms can never collide on the same lines the way
 * two PRs both editing a shared `addDecorations()` function body once did. */
export interface PropPlacement {
  /** References a `FurnitureAssetDef.id` (src/assets/furniture/*.ts). */
  id: string;
  x: number;
  z: number;
  /** Height off the floor, meters — default 0. A collider is only attached
   * at y=0 (see `spawnProps` in `level/spawning.ts`): a decorative piece
   * stacked above another (e.g. a second crate on top of the first) doesn't
   * get a redundant second floor-plan collider at the same x/z. */
  y?: number;
  /** Radians around Y, applied to the built mesh generically — default 0.
   * Every furniture asset builds facing local +z; this is how a placement
   * points it at whichever wall/direction it actually needs. */
  rotation?: number;
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
  /** Height off the floor, meters — default `ITEM_HEIGHT` (level/spawning.ts). */
  y?: number;
}

/** Everything one room/area places in the level — the default export of
 * each file under `src/level/rooms/`. `src/level/rooms.ts` auto-discovers
 * every such file (via `import.meta.glob`) and flattens all of their
 * `props`/`items` together, so adding a new room's content means adding one
 * new file under `rooms/` and nothing else. */
export interface RoomContent {
  props?: PropPlacement[];
  items?: ItemSpawn[];
}
